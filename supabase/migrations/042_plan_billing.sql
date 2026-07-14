-- ============================================================
-- 042_plan_billing.sql — Two-tier plan billing (Managed vs Self-serve)
--
-- Two account plan types, on top of the wallet billing from migration
-- 041 (which stays as-is — both plan types still pay per-message from
-- their wallet separately):
--
--   'managed'            — one-time ₹4500/3-month term, collected
--                           outside the system (bank transfer/UPI).
--                           Super Admin creates the account directly
--                           and marks it active. If the WABA gets
--                           banned/restricted, Growth Saints
--                           re-provisions it — up to
--                           managed_renewals_max (4) times within the
--                           term. No self-serve billing gate applies.
--   'self_serve_monthly'/
--   'self_serve_quarterly' — real recurring Razorpay Subscriptions
--                           (₹1200/mo or ₹3000/quarter). Client signs
--                           up and subscribes themselves; access is
--                           gated on plan_status = 'active'. No
--                           re-provisioning support if banned.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS plan_type TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS plan_status TEXT NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS managed_renewals_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS managed_renewals_max INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_plan_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_plan_type_check'
  ) THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_plan_type_check
      CHECK (plan_type IN ('none', 'managed', 'self_serve_monthly', 'self_serve_quarterly'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_plan_status_check'
  ) THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_plan_status_check
      CHECK (plan_status IN ('inactive', 'active', 'cancelled'));
  END IF;
END $$;

-- ============================================================
-- WHATSAPP_ACCOUNT_EVENTS — a catch-all log of account-level Meta
-- webhook fields we don't otherwise act on (account_review_update,
-- account_alerts, messaging_limit_tier, phone_number_quality_update,
-- business_capability_update, etc.). We deliberately don't try to
-- parse a specific "banned" shape out of these — Meta's exact payload
-- for a WABA ban isn't something we can verify with confidence, so
-- every account-level event is logged, `flagged` is a best-effort
-- keyword heuristic (ban/restrict/reject/disable in the raw JSON), and
-- a platform admin reviews flagged rows to decide whether a managed
-- account actually needs re-provisioning.
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_account_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  field      TEXT NOT NULL,
  raw_value  JSONB NOT NULL,
  flagged    BOOLEAN NOT NULL DEFAULT false,
  resolved   BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_account_events_account
  ON whatsapp_account_events(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_account_events_flagged
  ON whatsapp_account_events(flagged, resolved) WHERE flagged AND NOT resolved;

ALTER TABLE whatsapp_account_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_account_events_select_platform ON whatsapp_account_events;
DROP POLICY IF EXISTS whatsapp_account_events_select_account ON whatsapp_account_events;
CREATE POLICY whatsapp_account_events_select_platform ON whatsapp_account_events FOR SELECT
  USING (is_platform_admin());
CREATE POLICY whatsapp_account_events_select_account ON whatsapp_account_events FOR SELECT
  USING (account_id IS NOT NULL AND is_account_member(account_id, 'admin'));
-- No client INSERT/UPDATE/DELETE — the webhook writes via service-role;
-- "resolved" is flipped by a platform-admin-only API route.
