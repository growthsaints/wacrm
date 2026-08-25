-- ============================================================
-- 082_httpsms_channel.sql — httpSMS as a THIRD, independent inbox
-- channel (github.com/NdoleStudio/httpsms)
--
-- Deliberately NOT a variant of the existing 'sms' channel
-- (Android SMS Gateway, migration 077/080) — a separate provider with
-- its own config table, own send/receive plumbing, own channel value.
-- Nothing about the existing 'whatsapp'/'sms' channels changes; this
-- is purely additive, same pattern migration 077 used to add 'sms'
-- alongside 'whatsapp' without touching it.
--
-- httpSMS is a cloud API (api.httpsms.com) that relays through a
-- phone running the httpSMS Android app — one config row per
-- connected phone number, keyed by an httpSMS account API key rather
-- than a self-hosted base_url/username/password like sms_config.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('whatsapp', 'sms', 'httpsms'));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_channel_check;
ALTER TABLE messages ADD CONSTRAINT messages_channel_check
  CHECK (channel IN ('whatsapp', 'sms', 'httpsms'));

CREATE TABLE IF NOT EXISTS httpsms_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label             TEXT NOT NULL DEFAULT 'httpSMS',
  -- E.164 phone number as registered on the httpSMS platform — this is
  -- the "from" on every send call, and how an inbound webhook is
  -- matched back to this config (see phone_numbers on the Webhook
  -- entity in httpSMS's own API).
  phone_number      TEXT NOT NULL,
  api_key           TEXT NOT NULL, -- AES-256-GCM encrypted, same primitive as sms_config
  status            TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected')),
  enabled           BOOLEAN NOT NULL DEFAULT true,
  -- Routing id for the inbound webhook URL + a per-config secret the
  -- account pastes into httpSMS's own webhook signing-key field, same
  -- shape as sms_config.webhook_token/webhook_secret (migration 077).
  webhook_token     TEXT NOT NULL UNIQUE,
  webhook_secret    TEXT NOT NULL, -- AES-256-GCM encrypted
  connected_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_httpsms_config_account ON httpsms_config(account_id);

-- Conversations/messages pin to whichever httpsms_config sent/received
-- them — same reasoning as sms_config_id (migration 080): if an
-- account ever connects more than one httpSMS phone number, a thread
-- must keep using the number the customer already saw.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS httpsms_config_id UUID REFERENCES httpsms_config(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS httpsms_config_id UUID REFERENCES httpsms_config(id) ON DELETE SET NULL;

ALTER TABLE httpsms_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS httpsms_config_select ON httpsms_config;
DROP POLICY IF EXISTS httpsms_config_insert ON httpsms_config;
DROP POLICY IF EXISTS httpsms_config_update ON httpsms_config;
DROP POLICY IF EXISTS httpsms_config_delete ON httpsms_config;
CREATE POLICY httpsms_config_select ON httpsms_config FOR SELECT USING (is_account_member(account_id));
CREATE POLICY httpsms_config_insert ON httpsms_config FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY httpsms_config_update ON httpsms_config FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY httpsms_config_delete ON httpsms_config FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON httpsms_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON httpsms_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
