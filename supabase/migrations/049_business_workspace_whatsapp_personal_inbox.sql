-- ============================================================
-- 049_business_workspace_whatsapp_personal_inbox.sql — message
-- capture + reply storage for the QR-linked personal WhatsApp
-- connection (migration 048).
--
-- Deliberately its own isolated set of tables, NOT the existing
-- contacts/conversations/messages the Cloud API module uses — mixing
-- the two would let a personal-WhatsApp-sourced conversation show up
-- in the official /inbox UI, which assumes every conversation is
-- Cloud-API-sendable. Two connection methods, two data homes; the new
-- "Personal Inbox" page is the only place these rows are read.
--
-- Only plain text messages are captured in this phase — media/
-- stickers/locations etc. are silently skipped (see
-- src/lib/whatsapp-personal/socket-manager.ts), and group chats
-- (`@g.us` JIDs) are excluded entirely; this is a 1:1 capture tool.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_whatsapp_personal_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, phone_number)
);

ALTER TABLE workspace_whatsapp_personal_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_whatsapp_personal_contacts_select ON workspace_whatsapp_personal_contacts;
CREATE POLICY workspace_whatsapp_personal_contacts_select ON workspace_whatsapp_personal_contacts FOR SELECT
  USING (is_account_member(account_id));

DROP TRIGGER IF EXISTS set_updated_at ON workspace_whatsapp_personal_contacts;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON workspace_whatsapp_personal_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS workspace_whatsapp_personal_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES workspace_whatsapp_personal_contacts(id) ON DELETE CASCADE UNIQUE,
  last_message_text TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_whatsapp_personal_conversations_account
  ON workspace_whatsapp_personal_conversations(account_id, last_message_at DESC);

ALTER TABLE workspace_whatsapp_personal_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_whatsapp_personal_conversations_select ON workspace_whatsapp_personal_conversations;
CREATE POLICY workspace_whatsapp_personal_conversations_select ON workspace_whatsapp_personal_conversations FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS workspace_whatsapp_personal_conversations_update ON workspace_whatsapp_personal_conversations;
CREATE POLICY workspace_whatsapp_personal_conversations_update ON workspace_whatsapp_personal_conversations FOR UPDATE
  USING (is_account_member(account_id)) WITH CHECK (is_account_member(account_id));

DROP TRIGGER IF EXISTS set_updated_at ON workspace_whatsapp_personal_conversations;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON workspace_whatsapp_personal_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS workspace_whatsapp_personal_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES workspace_whatsapp_personal_conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content_text TEXT NOT NULL,
  wa_message_id TEXT,
  sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_whatsapp_personal_messages_conversation
  ON workspace_whatsapp_personal_messages(conversation_id, created_at);
-- Idempotency for inbound capture: Baileys can redeliver the same
-- message.upsert event (reconnects, retries) — this stops duplicates
-- without the caller needing its own dedup logic. A plain (not
-- partial) unique constraint on purpose: standard SQL NULL semantics
-- already make distinct NULLs never conflict, giving the same effect
-- as a `WHERE wa_message_id IS NOT NULL` predicate — and a plain
-- constraint is what Supabase's `.upsert(..., { onConflict })` can
-- target directly (it can't express a partial-index predicate).
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_whatsapp_personal_messages_wa_id
  ON workspace_whatsapp_personal_messages(conversation_id, wa_message_id);

ALTER TABLE workspace_whatsapp_personal_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_whatsapp_personal_messages_select ON workspace_whatsapp_personal_messages;
CREATE POLICY workspace_whatsapp_personal_messages_select ON workspace_whatsapp_personal_messages FOR SELECT
  USING (is_account_member(account_id));

-- All writes (inbound capture + outbound send) go through the server
-- (service-role client in socket-manager.ts) — no client INSERT
-- policy needed on any of the three tables above.
