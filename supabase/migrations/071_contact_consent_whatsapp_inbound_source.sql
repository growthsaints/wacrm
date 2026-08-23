-- ============================================================
-- 071_contact_consent_whatsapp_inbound_source.sql
--
-- Widens 070_contact_consent.sql's `source` CHECK to add
-- 'whatsapp_inbound' — a contact whose first-ever interaction with
-- the business was messaging us on WhatsApp themselves. Recorded as
-- `opted_in` directly (no consent-request template needed — they
-- initiated the conversation, not us), and only ever inserted, never
-- used to override an existing tracked status from another source
-- (see lib/contacts/consent.ts's recordImplicitConsentFromInboundMessage).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE contact_consent DROP CONSTRAINT IF EXISTS contact_consent_source_check;
ALTER TABLE contact_consent ADD CONSTRAINT contact_consent_source_check
  CHECK (source IN ('website', 'csv_import', 'meta_ads', 'manual', 'unknown', 'whatsapp_inbound'));
