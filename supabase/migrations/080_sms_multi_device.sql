-- ============================================================
-- 080_sms_multi_device.sql — multiple SMS Gateway devices per account
--
-- Migration 077 made sms_config one-row-per-account (UNIQUE(account_id)).
-- An account scaling bulk SMS throughput needs many phones/SIMs behind
-- one account — each with its own daily send cap (a SIM's own carrier
-- limit is independent of every other SIM's). This migration:
--
--   1. Drops the one-device-per-account constraint and adds `label` so
--      multiple rows are distinguishable in the UI ("Phone 1", "Sales
--      SIM", etc.).
--   2. Pins each SMS conversation to the device that's handling it
--      (conversations.sms_config_id) — once a customer's thread starts
--      on a given phone number, replies must keep coming from that same
--      number or the thread breaks on the customer's end (SMS
--      conversations are phone-number-identified, unlike WhatsApp).
--      New conversations are assigned round-robin to whichever enabled
--      device has the most capacity left today (see
--      lib/sms/device-assignment.ts) — application logic, not this
--      migration.
--   3. Denormalizes the same assignment onto messages.sms_config_id so
--      per-device daily-cap counting (lib/sms/daily-quota.ts) is a
--      single indexed filter, no join.
--
-- Backfill note: at the moment this migration runs, every account still
-- has at most one sms_config row (multi-row wasn't possible before this
-- migration), so the account_id → sms_config.id mapping below is
-- unambiguous.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE sms_config DROP CONSTRAINT IF EXISTS sms_config_account_id_key;
ALTER TABLE sms_config ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT 'SMS Gateway';
CREATE INDEX IF NOT EXISTS idx_sms_config_account ON sms_config(account_id);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS sms_config_id UUID REFERENCES sms_config(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sms_config_id UUID REFERENCES sms_config(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_sms_config_created
  ON messages(sms_config_id, created_at) WHERE sms_config_id IS NOT NULL;

UPDATE conversations c
SET sms_config_id = sc.id
FROM sms_config sc
WHERE c.channel = 'sms' AND c.sms_config_id IS NULL AND sc.account_id = c.account_id;

UPDATE messages m
SET sms_config_id = c.sms_config_id
FROM conversations c
WHERE m.conversation_id = c.id
  AND m.channel = 'sms'
  AND m.sms_config_id IS NULL
  AND c.sms_config_id IS NOT NULL;
