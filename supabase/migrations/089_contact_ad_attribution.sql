-- ============================================================
-- 089_contact_ad_attribution.sql — records which Click-to-WhatsApp ad
-- (if any) brought a contact in, so wacrm can answer "which contact
-- came from which ad" without a trip to Ads Manager.
--
-- Populated from the WhatsApp webhook's `referral` object (present on
-- an inbound message only when it originated from tapping an ad) —
-- see processMessage in app/api/whatsapp/webhook/route.ts. Set once,
-- the first time it's seen for a contact, and never overwritten —
-- this is deliberately a first-touch record, not last-touch, so a
-- contact's original acquisition source stays stable even if they
-- later click a different ad.
--
-- `ad_id` is Meta's ad id (referral.source_id) — it matches
-- meta_ad_campaigns.meta_ad_id when the ad was launched from wacrm
-- itself, letting the UI show the campaign's own name instead of a
-- raw id; `ad_headline` is the ad's own headline text, always
-- available as a human-readable fallback even for an ad wacrm didn't
-- create (e.g. one built directly in Ads Manager).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS ad_id TEXT,
  ADD COLUMN IF NOT EXISTS ad_headline TEXT;

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_source_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_source_check
  CHECK (source IS NULL OR source IN ('manual', 'import', 'api', 'whatsapp_inbound', 'whatsapp_ad'));
