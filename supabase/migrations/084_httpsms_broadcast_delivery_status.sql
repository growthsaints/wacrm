-- ============================================================
-- 084_httpsms_broadcast_delivery_status.sql — real delivery
-- confirmation on bulk httpSMS recipients
--
-- Until now, httpsms_broadcast_recipients.status only ever reached
-- 'sent' — meaning "httpSMS's API accepted the send call," not "the
-- recipient's phone actually got it." httpSMS reports the real outcome
-- asynchronously via webhook (message.phone.delivered /
-- message.send.failed / message.send.expired — see
-- api/httpsms/webhook/[token]/route.ts), but the webhook had no way to
-- find which recipient row a given status event belonged to.
--
-- message_id closes that loop: stamped onto the recipient row at send
-- time (the same messages.id passed to httpSMS as request_id and
-- stored on messages.message_id's *provider* counterpart — see
-- lib/httpsms/send-message.ts), the webhook's status handler now looks
-- up the recipient by it and updates status alongside messages.status.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE httpsms_broadcast_recipients
  ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES messages(id) ON DELETE SET NULL;

ALTER TABLE httpsms_broadcast_recipients DROP CONSTRAINT IF EXISTS httpsms_broadcast_recipients_status_check;
ALTER TABLE httpsms_broadcast_recipients ADD CONSTRAINT httpsms_broadcast_recipients_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'failed'));
