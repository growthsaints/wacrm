-- ============================================================
-- 074_notifications_quality_rating_type.sql
--
-- Widens `notifications.type` (currently 'conversation_assigned',
-- 'mention' per migration 054) to add 'quality_rating_changed' — sent
-- to the account owner directly when Meta's `phone_number_quality_update`
-- webhook field reports the number's quality rating has worsened (see
-- lib/whatsapp/quality-alert.ts). Unlike the opt-in Campaign
-- Intelligence module's Automation Rules (migration 045, which only
-- stamp `last_triggered_at` and require an Enterprise license), this is
-- a core, always-on notification every account gets — the number's
-- quality rating dropping is exactly the kind of signal that shouldn't
-- depend on an add-on being purchased first.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'mention', 'quality_rating_changed'));
