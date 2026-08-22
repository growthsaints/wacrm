-- ============================================================
-- 067_payment_gateway_configs.sql — Ecommerce Notification Integration,
-- Phase 2b: per-account payment gateway webhook config (Razorpay
-- first, Stripe-extensible).
--
-- Unlike the generic ecommerce receiver (Phase 2a, API-key/bearer
-- authenticated), a payment gateway posts to a URL you configure in
-- *its* dashboard and signs the payload with *its own* HMAC scheme —
-- there's no wacrm API key in the request at all. This table is what
-- lets `POST /api/v1/payments/webhook/{id}` find "which account, which
-- gateway, which secret to verify against" from the `{id}` path
-- segment alone, mirroring the existing `commerce_connections`-style
-- webhook routes (`/api/commerce/shopify/webhook/[connectionId]`).
--
-- Design notes
--   - `gateway` is CHECK-constrained (unlike `notification_rules
--     .event`, which is app-validated) because the signature verifier
--     to use is a hardcoded per-gateway code branch, not config —
--     an unknown gateway value could never be handled correctly
--     regardless, so rejecting it at the DB layer is strictly safer.
--     Extend the CHECK when a second gateway (e.g. 'stripe') ships.
--   - `webhook_secret` is AES-256-GCM-encrypted at rest (same
--     `encrypt()`/`decrypt()` as `whatsapp_config.access_token` and
--     `webhook_endpoints.secret`) — decrypted just-in-time to verify
--     each inbound delivery's signature.
--   - `UNIQUE (account_id, gateway)` — one config per gateway per
--     account; re-configuring is an UPDATE via PATCH, not a new row.
--   - `is_active` lets an admin pause a gateway (e.g. mid-rotation of
--     the webhook secret) without deleting the row.
--
-- RLS
--   Settings-class, identical shape to `notification_rules` /
--   `webhook_endpoints`: any member may read (never the secret itself
--   — that's excluded at the app layer's serialization, same as
--   `webhook_endpoints.secret`); only admin+ may create/update/delete.
--   The receiver itself runs under the service-role client.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_gateway_configs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  gateway        text NOT NULL CHECK (gateway IN ('razorpay')),
  webhook_secret text NOT NULL, -- AES-256-GCM-encrypted
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_gateway_configs_account_gateway_idx
  ON payment_gateway_configs (account_id, gateway);

ALTER TABLE payment_gateway_configs ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the account (viewer+) can see the roster.
DROP POLICY IF EXISTS payment_gateway_configs_select ON payment_gateway_configs;
CREATE POLICY payment_gateway_configs_select ON payment_gateway_configs FOR SELECT
  USING (is_account_member(account_id));

-- INSERT / UPDATE / DELETE: admin+ only (settings-class).
DROP POLICY IF EXISTS payment_gateway_configs_insert ON payment_gateway_configs;
CREATE POLICY payment_gateway_configs_insert ON payment_gateway_configs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS payment_gateway_configs_update ON payment_gateway_configs;
CREATE POLICY payment_gateway_configs_update ON payment_gateway_configs FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS payment_gateway_configs_delete ON payment_gateway_configs;
CREATE POLICY payment_gateway_configs_delete ON payment_gateway_configs FOR DELETE
  USING (is_account_member(account_id, 'admin'));
