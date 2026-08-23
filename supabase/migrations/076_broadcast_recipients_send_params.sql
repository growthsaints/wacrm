-- ============================================================
-- 076_broadcast_recipients_send_params.sql
--
-- Persists each recipient's template body params (the {{1}}, {{2}}, …
-- personalization values) onto the `broadcast_recipients` row itself.
-- Previously these only existed in-memory for the one request that
-- created the broadcast — fine for the original "send once" flow, but
-- resumeBroadcastDelivery (see lib/whatsapp/broadcast-core.ts, added
-- alongside the test-batch-first gate) needs to re-send a recipient's
-- personalized message later, after the initial request has long since
-- finished.
--
-- Nullable + no default: existing rows simply have no stored params
-- (same as before this migration — a resend of an old broadcast falls
-- back to an empty params array, matching how the dashboard's own
-- resumeBroadcast() already behaves for stuck-pending recovery).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS send_params JSONB;
