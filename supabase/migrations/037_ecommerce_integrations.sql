-- ============================================================
-- 037_ecommerce_integrations.sql — Custom ecommerce → WhatsApp
-- notification pipeline (docs/ecommerce-integration.md).
--
-- Lets an account wire an external (non-Shopify/WooCommerce) store to
-- wacrm's WhatsApp sends without any wacrm code change per client:
--
--   notification_rules      — event -> template mapping, configured
--                              once via POST /api/v1/notification-rules
--   payment_gateway_configs — Razorpay webhook receivers
--                              (POST /api/v1/payment-gateways)
--   shipping_configs        — generic carrier webhook receivers
--                              (POST /api/v1/shipping-configs)
--   ecommerce_webhook_events — idempotency ledger for
--                              POST /api/v1/ecommerce/webhook
--                              (Idempotency-Key header) and the
--                              Razorpay receiver (payment/refund id)
--
-- Design notes
--   - All four tables are account-scoped, never user-scoped — same
--     tenancy model as `api_keys` / `webhook_endpoints`.
--   - `payment_gateway_configs.webhook_secret` and
--     `shipping_configs.webhook_secret` are AES-256-GCM-encrypted at
--     rest (`encrypt()`/`decrypt()`, same as `webhook_endpoints.
--     secret`). UNLIKE `webhook_endpoints` (where wacrm generates the
--     secret because wacrm signs outgoing deliveries), here the
--     *caller* chooses the secret — Razorpay's dashboard requires a
--     specific string, and the generic shipping scheme just needs
--     both sides to agree on one — so it is a request field, not
--     server-generated, and is therefore never "shown once" the way
--     a webhook_endpoints secret is.
--   - `notification_rules` is UNIQUE per (account_id, event): one
--     template per event, matching the guide's "repeat for every
--     event you want to notify on".
--   - `ecommerce_webhook_events` is a claim-first idempotency ledger:
--     a row is inserted with status='processing' before any side
--     effect runs; the UNIQUE(account_id, idempotency_key) index is
--     what makes a concurrent duplicate 409 instead of double-sending
--     a WhatsApp message. `response_status`/`response_body` let a
--     retried call after completion replay the original response.
--
-- RLS
--   Settings-class, mirroring `webhook_endpoints`: any member may
--   read the roster; only admin+ may create/update/delete. The public
--   API management routes and the receiver routes both use the
--   service-role client, so RLS is the guard for any dashboard UI
--   that reads these tables directly.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event             text NOT NULL,             -- e.g. 'order.shipped' — validated in app layer against src/lib/ecommerce/events.ts
  template_name     text NOT NULL,
  template_language text NOT NULL DEFAULT 'en_US',
  param_mapping     jsonb NOT NULL DEFAULT '[]'::jsonb,  -- ordered array of dot-paths into the webhook's `data` object
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, event)
);

CREATE INDEX IF NOT EXISTS notification_rules_account_id_idx
  ON notification_rules (account_id);

ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_rules_select ON notification_rules;
CREATE POLICY notification_rules_select ON notification_rules FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS notification_rules_insert ON notification_rules;
CREATE POLICY notification_rules_insert ON notification_rules FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS notification_rules_update ON notification_rules;
CREATE POLICY notification_rules_update ON notification_rules FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS notification_rules_delete ON notification_rules;
CREATE POLICY notification_rules_delete ON notification_rules FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
CREATE TABLE IF NOT EXISTS payment_gateway_configs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  gateway        text NOT NULL,              -- currently only 'razorpay'
  webhook_secret text NOT NULL,              -- AES-256-GCM-encrypted; chosen by the caller, mirrored into Razorpay's dashboard
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, gateway)
);

CREATE INDEX IF NOT EXISTS payment_gateway_configs_account_id_idx
  ON payment_gateway_configs (account_id);

ALTER TABLE payment_gateway_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_gateway_configs_select ON payment_gateway_configs;
CREATE POLICY payment_gateway_configs_select ON payment_gateway_configs FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS payment_gateway_configs_insert ON payment_gateway_configs;
CREATE POLICY payment_gateway_configs_insert ON payment_gateway_configs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS payment_gateway_configs_delete ON payment_gateway_configs;
CREATE POLICY payment_gateway_configs_delete ON payment_gateway_configs FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
CREATE TABLE IF NOT EXISTS shipping_configs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  carrier        text NOT NULL,              -- free text, e.g. 'delhivery' — no fixed courier vocabulary
  webhook_secret text NOT NULL,              -- AES-256-GCM-encrypted; chosen by the caller, used to verify X-Wacrm-Signature
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shipping_configs_account_id_idx
  ON shipping_configs (account_id);

ALTER TABLE shipping_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shipping_configs_select ON shipping_configs;
CREATE POLICY shipping_configs_select ON shipping_configs FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS shipping_configs_insert ON shipping_configs;
CREATE POLICY shipping_configs_insert ON shipping_configs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shipping_configs_delete ON shipping_configs;
CREATE POLICY shipping_configs_delete ON shipping_configs FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
CREATE TABLE IF NOT EXISTS ecommerce_webhook_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  status          text NOT NULL DEFAULT 'processing', -- 'processing' | 'done' | 'failed'
  response_status int,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ecommerce_webhook_events_account_id_idx
  ON ecommerce_webhook_events (account_id);

-- Internal ledger only (the claim/replay path always uses the
-- service-role client) — RLS is enabled with no policies, which
-- denies all access under RLS-respecting clients by default.
ALTER TABLE ecommerce_webhook_events ENABLE ROW LEVEL SECURITY;
