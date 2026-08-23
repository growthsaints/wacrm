-- ============================================================
-- 072_contact_consent_auto_track.sql
--
-- Automatically creates a `contact_consent` row for EVERY new contact,
-- regardless of which code path created it — manual "Add Contact"
-- (client-side insert, no server route in between at all), CSV import,
-- the public API (`POST /api/v1/contacts`), or the inbound WhatsApp
-- webhook. A DB trigger is the only way to guarantee this: the manual
-- add path inserts directly from the browser via the RLS-scoped
-- client, so there is no shared server-side function to hook into —
-- and any future contact-creation path gets covered automatically too,
-- without needing to remember to wire it in.
--
-- Mapping, keyed on `contacts.source` (added in migration 039,
-- CHECK-constrained to manual/import/api/whatsapp_inbound/NULL):
--   'whatsapp_inbound' → contact_consent 'opted_in'  (they messaged
--       us first — no consent-request needed; overlaps harmlessly
--       with the webhook's own `recordImplicitConsentFromInboundMessage`
--       call, which exists as a backstop for rows that predate this
--       migration)
--   'manual'           → contact_consent 'pending', source 'manual'
--   'import'           → contact_consent 'pending', source 'csv_import'
--   'api' / NULL       → contact_consent 'pending', source 'unknown'
--       ('api'-created contacts get upgraded to 'opted_in'/'website'
--       immediately after by `POST /api/v1/contacts` itself when the
--       caller passes `consent_given: true` — e.g. a website form that
--       already collected consent — see lib/contacts/consent.ts's
--       `applyWebsiteConsentIfGiven`)
--
-- No auto-send of any template here — per this codebase's account
-- owner's explicit decision, sending consent-request messages is a
-- deliberate, rate-limited, admin-triggered batch action (see the
-- `send-batch` endpoint), never automatic on contact creation. Bulk-
-- messaging a freshly-imported, non-consented list is the same
-- pattern that risks a WABA/quality-rating restriction in the first
-- place.
--
-- `ON CONFLICT ... DO NOTHING`: a contact_consent row can already
-- exist for this phone (e.g. re-importing the same number, or a race
-- with another creation path) — never overwrite a status that's
-- already tracked.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_contact_consent_on_contact_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO contact_consent (account_id, contact_id, phone_number, source, consent_status)
  VALUES (
    NEW.account_id,
    NEW.id,
    NEW.phone,
    CASE NEW.source
      WHEN 'whatsapp_inbound' THEN 'whatsapp_inbound'
      WHEN 'import'           THEN 'csv_import'
      WHEN 'manual'           THEN 'manual'
      ELSE 'unknown'
    END,
    CASE WHEN NEW.source = 'whatsapp_inbound' THEN 'opted_in' ELSE 'pending' END
  )
  ON CONFLICT (account_id, phone_number) DO NOTHING;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_contact_consent_on_contact_insert() OWNER TO postgres;

DROP TRIGGER IF EXISTS contact_consent_on_contact_insert ON contacts;
CREATE TRIGGER contact_consent_on_contact_insert
  AFTER INSERT ON contacts
  FOR EACH ROW EXECUTE FUNCTION public.sync_contact_consent_on_contact_insert();
