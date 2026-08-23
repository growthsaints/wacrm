-- ============================================================
-- 075_broadcast_awaiting_confirmation.sql
--
-- Widens `broadcasts.status` (migration 001: draft/scheduled/sending/
-- sent/failed) to add 'awaiting_confirmation' — the new state a
-- broadcast lands in after its test batch goes out (see
-- lib/whatsapp/test-batch.ts), when the audience is large enough that
-- a bad template/audience shouldn't reach everyone in one shot. The
-- remaining recipients stay `broadcast_recipients.status = 'pending'`
-- exactly as an interrupted send already leaves them — the existing
-- "Resend to Pending" action on the broadcast detail page (already
-- wired to `resumeBroadcast()`) doubles as the confirmation step,
-- no new send path needed.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_status_check;
ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_status_check
  CHECK (status IN ('draft', 'scheduled', 'sending', 'awaiting_confirmation', 'sent', 'failed'));
