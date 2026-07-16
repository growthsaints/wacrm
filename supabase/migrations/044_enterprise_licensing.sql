-- ============================================================
-- 044_enterprise_licensing.sql — Enterprise module licensing
--
-- Foundation for the "Campaign Intelligence & Account Health Center"
-- enterprise add-on: a per-tenant license row (master switch + one
-- boolean per sub-feature) that a Super Admin controls, and an audit
-- trail of every change. Every tenant gets a row on first read (via
-- the API layer, not a trigger) rather than being defaulted in bulk
-- here — existing accounts are unaffected until a platform admin
-- explicitly grants access.
--
-- Idempotent — mirrors every earlier migration's IF NOT EXISTS / DROP
-- POLICY IF EXISTS conventions.
-- ============================================================

CREATE TABLE IF NOT EXISTS enterprise_licenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE UNIQUE,

  -- Master switch — everything else is inert while this is false,
  -- regardless of the individual feature booleans below.
  enterprise_enabled BOOLEAN NOT NULL DEFAULT false,

  -- One toggle per sub-feature (see FEATURE FLAG SYSTEM in the spec).
  -- Overview/Campaign Analyzer/Contact Intelligence/Engagement
  -- Analytics ride along with `campaign_intelligence` itself (no
  -- separate flag) — these ten are the ones the spec calls out as
  -- independently controllable.
  campaign_intelligence BOOLEAN NOT NULL DEFAULT false,
  account_health BOOLEAN NOT NULL DEFAULT false,
  delivery_insights BOOLEAN NOT NULL DEFAULT false,
  queue_engine BOOLEAN NOT NULL DEFAULT false,
  warmup_center BOOLEAN NOT NULL DEFAULT false,
  template_intelligence BOOLEAN NOT NULL DEFAULT false,
  ai_recommendations BOOLEAN NOT NULL DEFAULT false,
  risk_center BOOLEAN NOT NULL DEFAULT false,
  compliance_center BOOLEAN NOT NULL DEFAULT false,
  automation_rules BOOLEAN NOT NULL DEFAULT false,

  -- Grant metadata — one access type/expiry per tenant license (not
  -- per individual feature), matching the Enterprise Feature Manager's
  -- own table shape (one row per tenant with all features as columns).
  access_type TEXT NOT NULL DEFAULT 'none'
    CHECK (access_type IN ('none', 'permanent', 'trial', 'beta', 'vip', 'internal_team', 'partner', 'free')),
  start_date TIMESTAMPTZ,
  expiry_date TIMESTAMPTZ,
  reason TEXT,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enterprise_licenses_account ON enterprise_licenses(account_id);

ALTER TABLE enterprise_licenses ENABLE ROW LEVEL SECURITY;

-- Tenant members can read their own license (needed for sidebar
-- gating and any in-app "your plan" surface) — read-only, no INSERT/
-- UPDATE policy for tenants. Platform admins can read every row.
DROP POLICY IF EXISTS enterprise_licenses_select ON enterprise_licenses;
CREATE POLICY enterprise_licenses_select ON enterprise_licenses FOR SELECT
  USING (is_account_member(account_id) OR is_platform_admin());

-- Writes only via the service-role client (src/lib/platform/admin-client.ts),
-- itself gated by requirePlatformAdmin() at the route layer — same
-- split as platform_admins / impersonation_log above.

-- Auto-expire: a license past its expiry_date is treated as disabled
-- by the application layer (getEnterpriseFeatures() checks expiry_date
-- against now()) rather than a cron flipping the row — keeps the
-- "still shows the original grant metadata" audit value intact.

-- Reuses update_updated_at_column() from 001_initial_schema.sql.
DROP TRIGGER IF EXISTS set_updated_at ON enterprise_licenses;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON enterprise_licenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ENTERPRISE_AUDIT_LOG — one row per feature-flag change.
-- Platform-admin-only, mirrors impersonation_log's shape/policy.
-- ============================================================
CREATE TABLE IF NOT EXISTS enterprise_audit_log (
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

CREATE INDEX IF NOT EXISTS idx_enterprise_audit_log_account ON enterprise_audit_log(account_id, created_at DESC);

ALTER TABLE enterprise_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enterprise_audit_log_select ON enterprise_audit_log;
CREATE POLICY enterprise_audit_log_select ON enterprise_audit_log FOR SELECT
  USING (is_platform_admin());
