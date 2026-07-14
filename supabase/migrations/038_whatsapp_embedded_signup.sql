-- ============================================================
-- 038_whatsapp_embedded_signup.sql — Official Meta Embedded Signup
--
-- Adds cached, human-readable Meta metadata to `whatsapp_config` so
-- the new WhatsApp Management UI can render Business Name, Display
-- Name, Phone Number, Quality Rating, Messaging Limit, Verified
-- Status, and Last Sync without a live Graph API call on every page
-- load. Every column is nullable / defaulted so existing manually-
-- connected rows are completely unaffected — they simply show as
-- "not yet synced" until the next Refresh Status click.
--
-- Deliberately NOT a new table: the existing one-number-per-account
-- invariant (`whatsapp_config_account_id_key`, migration 017) is kept
-- as-is for this milestone. Multi-number-per-account is a documented
-- future limitation, not implemented here.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS display_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS business_name TEXT,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS quality_rating TEXT,
  ADD COLUMN IF NOT EXISTS messaging_limit_tier TEXT,
  ADD COLUMN IF NOT EXISTS code_verification_status TEXT,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  -- 'manual'          — existing self-hosted / hand-entered flow (default,
  --                      so every pre-migration row keeps its current
  --                      behaviour exactly).
  -- 'embedded_signup' — connected via the official Meta Embedded Signup
  --                      flow (Facebook Login for Business popup).
  ADD COLUMN IF NOT EXISTS onboarding_method TEXT NOT NULL DEFAULT 'manual',
  -- Meta Business Manager id, captured from the Embedded Signup
  -- postMessage payload. Internal use only (re-fetching business_name
  -- on Refresh Status) — never rendered in any UI, tenant or admin.
  ADD COLUMN IF NOT EXISTS business_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_config_onboarding_method_check'
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_onboarding_method_check
      CHECK (onboarding_method IN ('manual', 'embedded_signup'));
  END IF;
END $$;
