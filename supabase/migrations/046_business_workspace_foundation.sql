-- ============================================================
-- 046_business_workspace_foundation.sql — Business Workspace™
--
-- Foundation for a second, independent premium module aimed at
-- businesses that run day-to-day operations primarily through
-- WhatsApp: Customer Hub, Customer 360, Shared Inbox, Team Workspace,
-- AI Assistant, Labels, Notes, Follow-up Center, Calendar, Deals,
-- Campaign Planner, Analytics, Reports. Entirely additive — nothing
-- here touches the existing WhatsApp Cloud API module, its tables, or
-- its behavior. Mirrors 044_enterprise_licensing.sql's shape (one
-- license row per tenant, one boolean per sub-feature, Super-Admin-
-- controlled) so both premium add-ons share one mental model.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS business_workspace_licenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE UNIQUE,

  -- Master switch — every feature below is inert while this is
  -- false, regardless of its own toggle.
  workspace_enabled BOOLEAN NOT NULL DEFAULT false,

  -- One toggle per sub-feature (mirrors the module's own sidebar).
  -- Overview rides along with the master switch — every tenant with
  -- workspace_enabled sees it, same as Campaign Intelligence's Overview.
  customer_hub BOOLEAN NOT NULL DEFAULT false,
  customer_360 BOOLEAN NOT NULL DEFAULT false,
  shared_inbox BOOLEAN NOT NULL DEFAULT false,
  team_workspace BOOLEAN NOT NULL DEFAULT false,
  ai_assistant BOOLEAN NOT NULL DEFAULT false,
  labels BOOLEAN NOT NULL DEFAULT false,
  notes BOOLEAN NOT NULL DEFAULT false,
  followup_center BOOLEAN NOT NULL DEFAULT false,
  calendar BOOLEAN NOT NULL DEFAULT false,
  deals BOOLEAN NOT NULL DEFAULT false,
  campaign_planner BOOLEAN NOT NULL DEFAULT false,
  analytics BOOLEAN NOT NULL DEFAULT false,
  reports BOOLEAN NOT NULL DEFAULT false,

  -- Grant metadata — same shape as enterprise_licenses.
  access_type TEXT NOT NULL DEFAULT 'none'
    CHECK (access_type IN ('none', 'permanent', 'trial', 'beta', 'vip', 'internal_team', 'partner', 'free')),
  start_date TIMESTAMPTZ,
  expiry_date TIMESTAMPTZ,
  reason TEXT,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes_admin TEXT, -- renamed from `notes` to avoid colliding with the `notes` feature-flag column above

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_workspace_licenses_account ON business_workspace_licenses(account_id);

ALTER TABLE business_workspace_licenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_workspace_licenses_select ON business_workspace_licenses;
CREATE POLICY business_workspace_licenses_select ON business_workspace_licenses FOR SELECT
  USING (is_account_member(account_id) OR is_platform_admin());

-- Writes only via the service-role client, gated by requirePlatformAdmin()
-- at the route layer — same split as enterprise_licenses.

DROP TRIGGER IF EXISTS set_updated_at ON business_workspace_licenses;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON business_workspace_licenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- BUSINESS_WORKSPACE_AUDIT_LOG — one row per feature-flag change.
-- Platform-admin-only, mirrors enterprise_audit_log's shape/policy.
-- ============================================================
CREATE TABLE IF NOT EXISTS business_workspace_audit_log (
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

CREATE INDEX IF NOT EXISTS idx_business_workspace_audit_log_account ON business_workspace_audit_log(account_id, created_at DESC);

ALTER TABLE business_workspace_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_workspace_audit_log_select ON business_workspace_audit_log;
CREATE POLICY business_workspace_audit_log_select ON business_workspace_audit_log FOR SELECT
  USING (is_platform_admin());

-- ============================================================
-- CONTACTS — additive columns for Customer Hub / Customer 360.
-- Nullable, no backfill: existing rows genuinely have no priority/
-- status/segment/owner assigned yet, so NULL ("—" in the UI) is the
-- honest value, not a fabricated default. These are shared with the
-- existing Contacts page/table — Business Workspace reuses the same
-- `contacts` row a tenant already has, it does not fork a parallel
-- customer table.
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS priority TEXT,
  ADD COLUMN IF NOT EXISTS workspace_status TEXT,
  ADD COLUMN IF NOT EXISTS segment TEXT,
  ADD COLUMN IF NOT EXISTS assigned_agent_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_priority_check'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_priority_check
      CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high', 'urgent'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_workspace_status_check'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_workspace_status_check
      CHECK (workspace_status IS NULL OR workspace_status IN ('active', 'inactive', 'vip', 'churned'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_assigned_agent ON contacts(assigned_agent_id);
