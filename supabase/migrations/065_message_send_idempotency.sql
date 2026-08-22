-- ============================================================
-- 065_message_send_idempotency.sql — Idempotency keys for
-- POST /api/v1/messages (Ecommerce Notification Integration spec, Phase 1).
--
-- External integrations (order/payment/shipping backends) retry a
-- webhook-triggered send on a timeout or 5xx without knowing whether
-- the first attempt actually went through — the classic "at-least-
-- once caller, exactly-once send" problem. This table lets a caller
-- pass an `Idempotency-Key` and get the *original* response replayed
-- instead of sending the WhatsApp message twice.
--
-- Design notes
--   - Keyed on (account_id, idempotency_key) — the key is caller-
--     chosen and only unique within one account, same scoping as
--     every other tenant table.
--   - Reserve-then-fill, not fill-then-insert: the route INSERTs a
--     row with `response_body = NULL` *before* sending anything. Two
--     concurrent requests for the same key race on this INSERT's
--     UNIQUE constraint (catch-conflict, same pattern as contact/
--     conversation dedup — see lib/contacts/dedupe.ts) — exactly one
--     wins and actually sends; the loser sees the conflict and either
--     replays the winner's `response_body` (if already filled in) or
--     gets a 409 telling it a send is already in flight (if not yet
--     filled in). This is what makes the key work under real
--     concurrency, not just sequential retries.
--   - `response_body` stores the exact JSON envelope returned once the
--     send completes, so a replay is byte-identical rather than a
--     re-derived approximation. A row whose send attempt failed is
--     deleted by the route rather than left NULL forever, so a retry
--     after a genuine failure isn't permanently blocked.
--   - No RLS policy for authenticated/anon — all access is
--     server-side via the service-role key (same pattern as
--     automation_pending_executions in 006_automations.sql).
--   - TODO: rows older than 7 days are safe to delete (Stripe's own
--     idempotency-key retention window) — no cleanup cron exists yet;
--     add one if this table's growth becomes a concern.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS message_send_idempotency (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  idempotency_key  text NOT NULL,
  message_id       uuid REFERENCES messages(id) ON DELETE SET NULL,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS message_send_idempotency_account_key_idx
  ON message_send_idempotency (account_id, idempotency_key);

ALTER TABLE message_send_idempotency ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE policy for authenticated users — all
-- access is server-side via the service-role key.
