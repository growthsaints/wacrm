-- ============================================================
-- 078_sms_config_enabled — separate on/off switch for the SMS channel
--
-- The SMS integration (migration 077) should be toggleable
-- independently of its saved credentials: an admin can pause the
-- channel (stop new sends and inbound webhook processing) without
-- losing the configured gateway URL/username/password, then flip it
-- back on later. Defaults true so the channel goes live immediately
-- when an admin first connects a gateway in Settings — the toggle is
-- for pausing an already-working integration, not an extra step
-- required just to turn it on.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE sms_config
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
