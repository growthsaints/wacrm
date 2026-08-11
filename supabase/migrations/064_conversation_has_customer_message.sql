-- ============================================================
-- conversations.has_customer_message
--
-- Business-initiated conversations (a broadcast, an automation, or a
-- manual template send to a contact who's never texted in) now get a
-- real conversation row + messages row as of the broadcast-thread fix
-- (see recordBroadcastMessage in api/whatsapp/broadcast/route.ts) — but
-- that meant EVERY broadcast recipient's thread started showing up in
-- the main Inbox list immediately, even ones who never replied. Other
-- WhatsApp CRM tools (e.g. AiSensy) only surface a conversation in the
-- default inbox view once the customer has actually sent something.
--
-- This column tracks that: false until the first customer-authored
-- message lands, true forever after (a reply can't be "un-sent"). The
-- Inbox list query filters on it directly; realtime pickup of a
-- conversation's first-ever reply still works because the message-
-- INSERT handler already falls back to an unfiltered per-id hydrate
-- fetch for any conversation it doesn't recognise yet (see
-- hydrateConversation in app/(dashboard)/inbox/page.tsx) — it doesn't
-- rely on the list's bulk query.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS has_customer_message BOOLEAN NOT NULL DEFAULT false;

-- Backfill: any conversation that already has a customer-sent message
-- (the overwhelming majority — inbound-initiated is still the normal
-- path) is marked true immediately, so nothing that should already be
-- visible in the inbox disappears when this ships.
UPDATE conversations c
SET has_customer_message = true
WHERE has_customer_message = false
  AND EXISTS (
    SELECT 1 FROM messages m
    WHERE m.conversation_id = c.id
      AND m.sender_type = 'customer'
  );

CREATE OR REPLACE FUNCTION public.mark_conversation_has_customer_message()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sender_type = 'customer' THEN
    UPDATE conversations
    SET has_customer_message = true
    WHERE id = NEW.conversation_id
      AND has_customer_message = false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS set_conversation_has_customer_message ON messages;
CREATE TRIGGER set_conversation_has_customer_message
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.mark_conversation_has_customer_message();
