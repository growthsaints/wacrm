-- ============================================================
-- 057_core_feature_licenses.sql — Super-Admin control over the
-- "core" paid features (Broadcasts, Automations, AI Agents).
--
-- Mirrors 044_enterprise_licensing.sql's shape (per-tenant row, one
-- boolean per feature, access-grant metadata, audit log) with one
-- deliberate reversal: Enterprise defaults every tenant to OFF (an
-- opt-in add-on nobody has unless granted); these three features are
-- already freely usable by every existing account today, so the
-- default here is ON. A tenant with NO row at all is still treated as
-- fully enabled by the application layer (see
-- src/lib/core-features/features.ts) — the row only needs to exist
-- once a platform admin actually changes something for that tenant
-- (grants, restricts, or sets an expiry). This is the additive,
-- non-breaking step: nothing reads this table yet to gate the actual
-- Broadcasts/Automations/AI Agents pages, so no existing account
-- loses access by this migration alone. Wiring real enforcement in is
-- a deliberate follow-up.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS core_feature_licenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE UNIQUE,

  -- One toggle per gated feature. Default true — see the file-level
  -- comment above on why this differs from enterprise_licenses.
  broadcasts_enabled BOOLEAN NOT NULL DEFAULT true,
  automations_enabled BOOLEAN NOT NULL DEFAULT true,
  ai_agents_enabled BOOLEAN NOT NULL DEFAULT true,

  -- Same grant-metadata shape as enterprise_licenses, for the same
  -- reason (one row per tenant, not per feature) and the same UI
  -- pattern in Platform → Core Features.
  access_type TEXT NOT NULL DEFAULT 'permanent'
    CHECK (access_type IN ('none', 'permanent', 'trial', 'beta', 'vip', 'internal_team', 'partner', 'free')),
  start_date TIMESTAMPTZ,
  expiry_date TIMESTAMPTZ,
  reason TEXT,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_core_feature_licenses_account ON core_feature_licenses(account_id);

ALTER TABLE core_feature_licenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS core_feature_licenses_select ON core_feature_licenses;
CREATE POLICY core_feature_licenses_select ON core_feature_licenses FOR SELECT
  USING (is_account_member(account_id) OR is_platform_admin());

-- Writes only via the service-role client (src/lib/platform/admin-client.ts),
-- itself gated by requirePlatformAdmin() at the route layer — same
-- split as enterprise_licenses.

DROP TRIGGER IF EXISTS set_updated_at ON core_feature_licenses;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON core_feature_licenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CORE_FEATURE_AUDIT_LOG — one row per feature-flag change.
-- Platform-admin-only, identical shape/policy to enterprise_audit_log.
-- ============================================================
CREATE TABLE IF NOT EXISTS core_feature_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_address TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_core_feature_audit_log_account
  ON core_feature_audit_log(account_id, created_at DESC);

ALTER TABLE core_feature_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS core_feature_audit_log_select ON core_feature_audit_log;
CREATE POLICY core_feature_audit_log_select ON core_feature_audit_log FOR SELECT
  USING (is_platform_admin());
