-- ============================================================
-- 068_shipping_configs.sql — Ecommerce Notification Integration,
-- Phase 2c: per-account shipping/courier webhook config.
--
-- Unlike payment gateways (Phase 2b), there's no single dominant
-- courier API with one universal webhook signature convention to
-- adapt to — every shipping/fulfillment system in the wild is
-- different, and many roll their own or none at all. So this
-- receiver defines its OWN convention instead of adapting to a
-- third party's: the same Stripe-style HMAC scheme wacrm already
-- uses for its own outbound webhooks (`X-Wacrm-Signature:
-- t=<unix>,v1=<hex>`, verified by `lib/webhooks/sign.ts`'s
-- `verifySignatureHeader` — already implemented, tested, and used
-- elsewhere, so this reuses it rather than inventing a second
-- verification scheme). An account puts this secret into whatever
-- middleware/relay sits in front of their actual courier (or their
-- own fulfillment system, if it's custom-built) to sign outgoing
-- calls to wacrm.
--
-- Design notes
--   - `carrier` is a free-text label for the admin's own reference
--     (e.g. "delhivery", "shiprocket", "in-house") — NOT tied to a
--     verifier code branch (there's only one verification scheme
--     here, unlike `payment_gateway_configs.gateway`), so it's
--     app-validated (non-empty string) rather than CHECK-constrained.
--   - `webhook_secret` is AES-256-GCM-encrypted at rest, same as
--     every other stored secret in this codebase.
--   - `UNIQUE (account_id, carrier)` — one config per named carrier
--     per account (an account juggling two couriers gets two rows,
--     each with its own webhook URL + secret).
--   - `is_active` lets an admin pause a carrier without deleting it.
--
-- RLS
--   Settings-class, identical shape to `payment_gateway_configs` /
--   `notification_rules`: any member may read; only admin+ may
--   create/update/delete. The receiver runs under the service-role
--   client.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS shipping_configs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  carrier        text NOT NULL,
  webhook_secret text NOT NULL, -- AES-256-GCM-encrypted
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shipping_configs_account_carrier_idx
  ON shipping_configs (account_id, carrier);

ALTER TABLE shipping_configs ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the account (viewer+) can see the roster.
DROP POLICY IF EXISTS shipping_configs_select ON shipping_configs;
CREATE POLICY shipping_configs_select ON shipping_configs FOR SELECT
  USING (is_account_member(account_id));

-- INSERT / UPDATE / DELETE: admin+ only (settings-class).
DROP POLICY IF EXISTS shipping_configs_insert ON shipping_configs;
CREATE POLICY shipping_configs_insert ON shipping_configs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shipping_configs_update ON shipping_configs;
CREATE POLICY shipping_configs_update ON shipping_configs FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shipping_configs_delete ON shipping_configs;
CREATE POLICY shipping_configs_delete ON shipping_configs FOR DELETE
  USING (is_account_member(account_id, 'admin'));
