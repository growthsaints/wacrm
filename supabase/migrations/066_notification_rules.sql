-- ============================================================
-- 066_notification_rules.sql — Ecommerce Notification Integration,
-- Phase 3: per-account event → WhatsApp template mapping.
--
-- The generic ecommerce/payment/shipping receivers (Phase 2a/2b/2c)
-- don't hardcode "which template for which event" — that varies per
-- account (different template names, different languages, different
-- approved variable order). This table is the config an admin fills
-- in once per event type; the receivers just look it up.
--
-- Design notes
--   - `event` is a free-text event key (e.g. "order.created",
--     "payment.captured", "shipment.delivered") — validated in the
--     app layer against each receiver's own known-event list, not a
--     DB CHECK constraint, so adding a new event type is a code
--     change, not a migration (same rationale as `webhook_endpoints
--     .events[]` in 028_webhook_endpoints.sql).
--   - `UNIQUE (account_id, event)` — at most one rule per event per
--     account; re-configuring an event is an UPSERT, not a new row.
--   - `param_mapping` is an ordered JSON array of dot-paths into the
--     inbound payload's `data` object (e.g. `["order.number",
--     "order.total"]`) — the receiver resolves each path in order to
--     build the template's positional body params. Defaults to `[]`
--     (a template with no variables needs no mapping).
--   - `template_language` defaults to `'en'`, matching the default a
--     freshly-created template gets in the Templates UI; an account
--     with a differently-languaged template must set this explicitly.
--   - `is_active` lets an admin disable a rule (event arrives, no
--     template fires) without deleting the row's configured mapping.
--
-- RLS
--   Settings-class, identical shape to `webhook_endpoints`: any
--   member may read the account's rules; only admin+ may create,
--   update, or delete one. The receivers themselves run under the
--   service-role client (API-key callers have no `auth.uid()`), so
--   this RLS is the guard for the dashboard UI reading the table
--   directly.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event             text NOT NULL,
  template_name     text NOT NULL,
  template_language text NOT NULL DEFAULT 'en',
  param_mapping     jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_rules_account_event_idx
  ON notification_rules (account_id, event);

ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the account (viewer+) can see the roster.
DROP POLICY IF EXISTS notification_rules_select ON notification_rules;
CREATE POLICY notification_rules_select ON notification_rules FOR SELECT
  USING (is_account_member(account_id));

-- INSERT / UPDATE / DELETE: admin+ only (settings-class).
DROP POLICY IF EXISTS notification_rules_insert ON notification_rules;
CREATE POLICY notification_rules_insert ON notification_rules FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS notification_rules_update ON notification_rules;
CREATE POLICY notification_rules_update ON notification_rules FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS notification_rules_delete ON notification_rules;
CREATE POLICY notification_rules_delete ON notification_rules FOR DELETE
  USING (is_account_member(account_id, 'admin'));
