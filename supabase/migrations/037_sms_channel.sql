-- ============================================================
-- 037_sms_channel — add SMS as a second inbox channel
--
-- wacrm's inbox has been WhatsApp-only at the schema level:
-- `conversations`/`messages` carry no channel column, and migration
-- 036 enforces one conversation per (account_id, contact_id). This
-- adds a `channel` column to both tables and a matching
-- `sms_config` table (modeled on `whatsapp_config`) so a contact can
-- have one WhatsApp conversation AND one SMS conversation, each
-- routed independently.
--
-- SMS delivery is via a self-hosted "SMS Gateway for Android" device
-- (https://github.com/capcom6/android-sms-gateway) — the account
-- owner points wacrm at their device/private-server's HTTP API
-- (Basic Auth) and pastes a wacrm-generated webhook URL into the
-- app's webhook settings for inbound delivery.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1) channel column on conversations + messages. Defaulting existing
--    rows to 'whatsapp' preserves the migration-036 unique index
--    below without a backfill step.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp', 'sms'));

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp', 'sms'));

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);

-- 2) Widen the one-conversation-per-contact index (036) to be per
--    (account, contact, channel) — a contact can now have one
--    WhatsApp thread and one SMS thread, each independently deduped.
DROP INDEX IF EXISTS idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_channel
  ON conversations(account_id, contact_id, channel);

-- 3) sms_config — one row per account, mirrors whatsapp_config.
--    `password` (Basic Auth) and `webhook_secret` (HMAC signing key)
--    are AES-256-GCM encrypted at rest via src/lib/whatsapp/encryption.ts
--    (re-exported from src/lib/sms/encryption.ts — same ENCRYPTION_KEY,
--    no reason to duplicate the cipher code).
--
--    `webhook_token` is an unguessable routing id (NOT a secret) —
--    it's the URL path segment (`/api/sms/webhook/<token>`) the
--    Android app is configured to POST to, so we can look up which
--    account's `webhook_secret` to verify the HMAC signature against
--    before we've authenticated the caller at all. It carries no
--    trust on its own.
CREATE TABLE IF NOT EXISTS sms_config (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  base_url       TEXT NOT NULL,
  username       TEXT NOT NULL,
  password       TEXT NOT NULL,             -- AES-256-GCM encrypted
  webhook_token  TEXT NOT NULL UNIQUE,
  webhook_secret TEXT NOT NULL,             -- AES-256-GCM encrypted
  status         TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  connected_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_config_webhook_token ON sms_config(webhook_token);

ALTER TABLE sms_config ENABLE ROW LEVEL SECURITY;

-- Settings-class RLS, same shape as whatsapp_config (migration 017):
-- any account member may read; only admin+ may write. The webhook
-- receiver and the config route's ownership checks use the
-- service-role client (an external caller / pre-auth path has no
-- auth.uid()), so RLS is the guard for dashboard UI reading directly.
DROP POLICY IF EXISTS sms_config_select ON sms_config;
DROP POLICY IF EXISTS sms_config_insert ON sms_config;
DROP POLICY IF EXISTS sms_config_update ON sms_config;
DROP POLICY IF EXISTS sms_config_delete ON sms_config;
CREATE POLICY sms_config_select ON sms_config FOR SELECT USING (is_account_member(account_id));
CREATE POLICY sms_config_insert ON sms_config FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY sms_config_update ON sms_config FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY sms_config_delete ON sms_config FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON sms_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON sms_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
