-- ============================================================
-- 079_sms_broadcasts.sql — bulk SMS sending
--
-- A separate table pair from `broadcasts`/`broadcast_recipients`
-- (WhatsApp-only, template-based) rather than widening those tables to
-- a second channel: SMS has no templates (plain text only), and
-- keeping this fully additive means zero schema/constraint changes to
-- the existing, heavily-used WhatsApp broadcast path — nothing there
-- needs to change to support this.
--
-- Mirrors broadcasts' shape where it makes sense (status ladder,
-- audience_filter JSONB for the record, per-recipient rows) but skips
-- what SMS doesn't need: template_name/language, delivered/read/replied
-- counts (the SMS Gateway app doesn't report those), scheduled sends.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS sms_broadcasts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  body_text         TEXT NOT NULL,
  -- Same shape as broadcasts.audience_filter — kept for the record /
  -- future re-send, not read back by any query today.
  audience_filter   JSONB,
  status            TEXT NOT NULL DEFAULT 'sending'
                       CHECK (status IN ('sending', 'sent', 'failed')),
  total_recipients  INTEGER NOT NULL DEFAULT 0,
  sent_count        INTEGER NOT NULL DEFAULT 0,
  failed_count      INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_broadcasts_account ON sms_broadcasts(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sms_broadcast_recipients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sms_broadcast_id  UUID NOT NULL REFERENCES sms_broadcasts(id) ON DELETE CASCADE,
  -- SET NULL on contact delete, same as broadcast_recipients.contact_id
  -- (migration 004) — history preserved, UI renders "Unknown".
  contact_id        UUID REFERENCES contacts(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'sent', 'failed')),
  error_message     TEXT,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_broadcast_recipients_broadcast
  ON sms_broadcast_recipients(sms_broadcast_id);

ALTER TABLE sms_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_broadcast_recipients ENABLE ROW LEVEL SECURITY;

-- Same shape as broadcasts/broadcast_recipients (migration 001/017):
-- any account member reads; agent+ may create/send (matches
-- canSendMessages, not admin-only — a regular agent can already send
-- one-off SMS from Contact Detail, bulk is the same capability at
-- scale).
DROP POLICY IF EXISTS sms_broadcasts_select ON sms_broadcasts;
DROP POLICY IF EXISTS sms_broadcasts_insert ON sms_broadcasts;
DROP POLICY IF EXISTS sms_broadcasts_update ON sms_broadcasts;
CREATE POLICY sms_broadcasts_select ON sms_broadcasts FOR SELECT USING (is_account_member(account_id));
CREATE POLICY sms_broadcasts_insert ON sms_broadcasts FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY sms_broadcasts_update ON sms_broadcasts FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS sms_broadcast_recipients_select ON sms_broadcast_recipients;
DROP POLICY IF EXISTS sms_broadcast_recipients_all ON sms_broadcast_recipients;
CREATE POLICY sms_broadcast_recipients_select ON sms_broadcast_recipients FOR SELECT USING (
  EXISTS (SELECT 1 FROM sms_broadcasts b WHERE b.id = sms_broadcast_recipients.sms_broadcast_id AND is_account_member(b.account_id))
);
CREATE POLICY sms_broadcast_recipients_all ON sms_broadcast_recipients FOR ALL USING (
  EXISTS (SELECT 1 FROM sms_broadcasts b WHERE b.id = sms_broadcast_recipients.sms_broadcast_id AND is_account_member(b.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM sms_broadcasts b WHERE b.id = sms_broadcast_recipients.sms_broadcast_id AND is_account_member(b.account_id, 'agent'))
);

DROP TRIGGER IF EXISTS set_updated_at ON sms_broadcasts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON sms_broadcasts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
