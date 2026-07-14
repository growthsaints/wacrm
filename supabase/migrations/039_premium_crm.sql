-- ============================================================
-- 039_premium_crm.sql — Premium CRM Experience (Milestone 3)
--
-- Schema support for the premium Inbox / Contact Timeline / Agent
-- Workspace work: contact provenance + lead scoring, conversation
-- pinning + an "archived" status, and a per-agent favorites list
-- (distinct from account-wide pinning — one is a shared team signal,
-- the other is a personal bookmark).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- contacts: provenance + lead scoring --------------------
-- `source` records how a contact entered the CRM so the Inbox/Contact
-- Timeline can show an honest "Lead Source" instead of guessing.
-- Nullable: every pre-migration row is genuinely of unknown origin,
-- and we'd rather show "Unknown" than fabricate a value.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS lead_score INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_source_check'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_source_check
      CHECK (source IS NULL OR source IN ('manual', 'import', 'api', 'whatsapp_inbound'));
  END IF;
END $$;

-- ---- conversations: pinning, assignment timestamp, archived -
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

-- Widen the status enum to add 'archived' — a fourth, explicit
-- end-state distinct from 'closed' (closed threads still show in the
-- default filters; archived ones are tucked away on purpose).
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_status_check;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_status_check
  CHECK (status IN ('open', 'pending', 'closed', 'archived'));

CREATE INDEX IF NOT EXISTS idx_conversations_pinned
  ON conversations(account_id, is_pinned) WHERE is_pinned;

-- `assigned_at` tracks when the current assignment was made (for the
-- Agent Workspace's "assigned chats" / response-time attribution).
-- Derived via trigger rather than touched at each of the three write
-- call sites (message-thread.tsx, the assign_conversation automation
-- step, and the AI handoff banner) so none of them can drift out of
-- sync with the column it's describing.
CREATE OR REPLACE FUNCTION public.set_conversation_assigned_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
    NEW.assigned_at := CASE WHEN NEW.assigned_agent_id IS NULL THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversation_assigned_at ON conversations;
CREATE TRIGGER trg_conversation_assigned_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_conversation_assigned_at();

-- ---- conversation_favorites: per-agent bookmark list --------
-- Distinct from is_pinned (team-wide, single column): each agent
-- keeps their own favorites list, so it's a join table.
CREATE TABLE IF NOT EXISTS conversation_favorites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_favorites_user
  ON conversation_favorites(account_id, user_id);

ALTER TABLE conversation_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_favorites_select ON conversation_favorites;
DROP POLICY IF EXISTS conversation_favorites_insert ON conversation_favorites;
DROP POLICY IF EXISTS conversation_favorites_delete ON conversation_favorites;

-- Each agent only sees/manages their own favorites — not a shared
-- team roster like is_pinned, so this is scoped to the caller, not
-- just the account.
CREATE POLICY conversation_favorites_select ON conversation_favorites FOR SELECT
  USING (is_account_member(account_id) AND user_id = auth.uid());
CREATE POLICY conversation_favorites_insert ON conversation_favorites FOR INSERT
  WITH CHECK (is_account_member(account_id) AND user_id = auth.uid());
CREATE POLICY conversation_favorites_delete ON conversation_favorites FOR DELETE
  USING (is_account_member(account_id) AND user_id = auth.uid());
