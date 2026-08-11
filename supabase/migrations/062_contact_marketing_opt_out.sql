-- ============================================================
-- 062_contact_marketing_opt_out.sql
--
-- Lets a contact opt out of marketing/broadcast messages, either by
-- replying STOP/UNSUBSCRIBE on WhatsApp (handled in the webhook route)
-- or via a manual toggle on the contact detail page. Broadcast
-- audience resolution (use-broadcast-sending.ts) excludes any contact
-- with marketing_opt_out = true, the same way it already excludes
-- contacts by excludeTagIds.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS marketing_opt_out BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ;
