-- ============================================================
-- 081_sms_broadcast_recipient_device.sql — which device sent it
--
-- With multiple SMS Gateway devices per account (migration 080),
-- there was no way to see which physical phone/SIM a given broadcast
-- recipient actually went out through — useful for exactly what it
-- sounds like: debugging a specific device (bad SIM, misconfigured
-- credentials, Android-level send failures) without guessing which
-- recipients used it.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE sms_broadcast_recipients
  ADD COLUMN IF NOT EXISTS sms_config_id UUID REFERENCES sms_config(id) ON DELETE SET NULL;
