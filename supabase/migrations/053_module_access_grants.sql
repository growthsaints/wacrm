-- ============================================================
-- 053_module_access_grants.sql — per-admin-user access grants for
-- Enterprise (Campaign Intelligence) and Business Workspace.
--
-- Closes the RBAC nuance documented (and deferred) since Campaign
-- Intelligence's original scoping: "Admin: no access by default, must
-- be manually enabled" — until now both modules treated owner and
-- admin identically (flat `role === 'owner' || role === 'admin'`).
-- From this migration on, an owner always has access; an admin only
-- does once explicitly granted here. Only the owner can grant/revoke
-- (an admin can't grant themselves or another admin access).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS module_access_grants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('enterprise', 'business_workspace')),
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, user_id, module)
);

CREATE INDEX IF NOT EXISTS idx_module_access_grants_lookup
  ON module_access_grants(account_id, user_id, module);

ALTER TABLE module_access_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS module_access_grants_select ON module_access_grants;
CREATE POLICY module_access_grants_select ON module_access_grants FOR SELECT
  USING (is_account_member(account_id, 'admin') OR user_id = auth.uid());

DROP POLICY IF EXISTS module_access_grants_insert ON module_access_grants;
CREATE POLICY module_access_grants_insert ON module_access_grants FOR INSERT
  WITH CHECK (is_account_member(account_id, 'owner'));

DROP POLICY IF EXISTS module_access_grants_delete ON module_access_grants;
CREATE POLICY module_access_grants_delete ON module_access_grants FOR DELETE
  USING (is_account_member(account_id, 'owner'));
