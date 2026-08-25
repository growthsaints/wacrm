-- ============================================================
-- 083_httpsms_broadcasts.sql — bulk sending over the httpSMS channel
--
-- Mirrors 079_sms_broadcasts.sql's shape (own table pair, not a widen
-- of broadcasts/broadcast_recipients — no templates, plain text only)
-- but for the httpsms_config-backed channel added in migration 082.
-- httpsms_config_id is included on recipients from the start (the SMS
-- Gateway equivalent only got this in migration 081, after the fact)
-- since which of possibly several connected numbers a recipient went
-- out from is exactly the kind of thing worth being able to see
-- immediately, not add later.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS httpsms_broadcasts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  body_text         TEXT NOT NULL,
  audience_filter   JSONB,
  status            TEXT NOT NULL DEFAULT 'sending'
                       CHECK (status IN ('sending', 'sent', 'failed')),
  total_recipients  INTEGER NOT NULL DEFAULT 0,
  sent_count        INTEGER NOT NULL DEFAULT 0,
  failed_count      INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_httpsms_broadcasts_account ON httpsms_broadcasts(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS httpsms_broadcast_recipients (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  httpsms_broadcast_id UUID NOT NULL REFERENCES httpsms_broadcasts(id) ON DELETE CASCADE,
  contact_id          UUID REFERENCES contacts(id) ON DELETE SET NULL,
  httpsms_config_id   UUID REFERENCES httpsms_config(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'sent', 'failed')),
  error_message       TEXT,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_httpsms_broadcast_recipients_broadcast
  ON httpsms_broadcast_recipients(httpsms_broadcast_id);

ALTER TABLE httpsms_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE httpsms_broadcast_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS httpsms_broadcasts_select ON httpsms_broadcasts;
DROP POLICY IF EXISTS httpsms_broadcasts_insert ON httpsms_broadcasts;
DROP POLICY IF EXISTS httpsms_broadcasts_update ON httpsms_broadcasts;
CREATE POLICY httpsms_broadcasts_select ON httpsms_broadcasts FOR SELECT USING (is_account_member(account_id));
CREATE POLICY httpsms_broadcasts_insert ON httpsms_broadcasts FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY httpsms_broadcasts_update ON httpsms_broadcasts FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS httpsms_broadcast_recipients_select ON httpsms_broadcast_recipients;
DROP POLICY IF EXISTS httpsms_broadcast_recipients_all ON httpsms_broadcast_recipients;
CREATE POLICY httpsms_broadcast_recipients_select ON httpsms_broadcast_recipients FOR SELECT USING (
  EXISTS (SELECT 1 FROM httpsms_broadcasts b WHERE b.id = httpsms_broadcast_recipients.httpsms_broadcast_id AND is_account_member(b.account_id))
);
CREATE POLICY httpsms_broadcast_recipients_all ON httpsms_broadcast_recipients FOR ALL USING (
  EXISTS (SELECT 1 FROM httpsms_broadcasts b WHERE b.id = httpsms_broadcast_recipients.httpsms_broadcast_id AND is_account_member(b.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM httpsms_broadcasts b WHERE b.id = httpsms_broadcast_recipients.httpsms_broadcast_id AND is_account_member(b.account_id, 'agent'))
);

DROP TRIGGER IF EXISTS set_updated_at ON httpsms_broadcasts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON httpsms_broadcasts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
