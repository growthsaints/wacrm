-- ============================================================
-- 069_notification_send_logs.sql — Ecommerce Notification Integration,
-- Phase 4: delivery reliability / observability log.
--
-- Every one of the three notification receivers (ecommerce webhook,
-- payment gateway webhook, shipping/courier webhook) writes one row
-- per inbound delivery it accepted (i.e. past signature/auth
-- verification), so an admin troubleshooting "why didn't my customer
-- get a WhatsApp message" has a single place to look instead of
-- grepping server logs across three different routes.
--
-- Design notes
--   - `source` identifies which receiver wrote the row — a plain
--     CHECK (not app-validated like `notification_rules.event`)
--     because the three sources are a fixed, small, code-level set
--     that only grows when a new receiver route is added (itself a
--     migration-worthy change).
--   - `phone` and `template_name` are nullable: a row logged before
--     rule resolution (e.g. `no_rule_configured`) has no template to
--     name, and one where the payload carried no phone at all
--     (`no_phone_in_payload`, the payment receiver's case) has none
--     to log either.
--   - `status`: `sent` (a fresh send happened), `replayed` (an
--     idempotency-key hit returned the prior send's outcome),
--     `skipped` (unrecognized event / no active rule / no phone —
--     `reason` explains which), `failed` (the send itself errored —
--     `reason` holds the error message).
--   - No foreign key to `messages` — a `failed`/`skipped` row has no
--     message to point at, and `sent`/`replayed` rows can be
--     correlated by `(phone, created_at)` proximity if needed; adding
--     a nullable FK later is a non-breaking follow-up if it turns out
--     to matter in practice.
--
-- RLS
--   Read-only for members (viewer+), matching `notification_rules` —
--   this is an audit trail, not a settings surface, so no role
--   restriction beyond account membership on SELECT. No INSERT/
--   UPDATE/DELETE policy: every write comes from a receiver route
--   running under the service-role client.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_send_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source        text NOT NULL CHECK (source IN ('ecommerce', 'payment', 'shipping')),
  event         text NOT NULL,
  phone         text,
  template_name text,
  status        text NOT NULL CHECK (status IN ('sent', 'replayed', 'skipped', 'failed')),
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_send_logs_account_created_idx
  ON notification_send_logs (account_id, created_at DESC);

ALTER TABLE notification_send_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_send_logs_select ON notification_send_logs;
CREATE POLICY notification_send_logs_select ON notification_send_logs FOR SELECT
  USING (is_account_member(account_id));
