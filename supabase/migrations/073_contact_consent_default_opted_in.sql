-- ============================================================
-- 073_contact_consent_default_opted_in.sql
--
-- Account owner's explicit decision: every contact — regardless of
-- source (manual add, CSV import, public API, WhatsApp inbound) —
-- starts `opted_in` rather than `pending`. `source` is still recorded
-- for audit purposes (where did this number come from), but it no
-- longer gates the initial consent_status.
--
-- This removes the built-in protection migrations 070-072 were
-- designed around (never auto-marking a bulk-imported/API-created
-- contact as consented without an explicit response) — flagged
-- clearly to the account owner before applying, who confirmed this is
-- the desired behavior.
--
-- Two parts:
--   1. Update the trigger (migration 072) to always insert
--      'opted_in' instead of branching on source.
--   2. Backfill existing 'pending' rows to 'opted_in' so past
--      contacts aren't left behind by the new default.
--
-- The consent-request batch-send endpoint (`POST /api/contacts
-- /consent/send-batch`) and the customer's YES_CONSENT/NO_CONSENT
-- button-tap handling both continue to work unchanged — they simply
-- have (much) less to do now, since new contacts arrive already
-- opted_in.
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
    'opted_in'
  )
  ON CONFLICT (account_id, phone_number) DO NOTHING;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_contact_consent_on_contact_insert() OWNER TO postgres;

-- Backfill: existing rows that were created 'pending' under the old
-- default now become 'opted_in' too, so reporting/filtering is
-- consistent with the new policy going forward.
UPDATE contact_consent
SET consent_status = 'opted_in'
WHERE consent_status = 'pending';
