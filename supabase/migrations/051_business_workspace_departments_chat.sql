-- ============================================================
-- 051_business_workspace_departments_chat.sql — Departments and
-- Internal Chat for Team Workspace (gated by the existing
-- team_workspace feature flag — no new flag needed).
--
-- Departments are a simple named grouping of account members (no
-- nested hierarchy, no per-department roles — this app's RBAC stays
-- flat at the account level; departments are organizational grouping
-- only). Internal Chat is scoped to "General" (department_id NULL) or
-- a specific department's channel.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

ALTER TABLE workspace_departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_departments_select ON workspace_departments;
CREATE POLICY workspace_departments_select ON workspace_departments FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS workspace_departments_insert ON workspace_departments;
CREATE POLICY workspace_departments_insert ON workspace_departments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS workspace_departments_update ON workspace_departments;
CREATE POLICY workspace_departments_update ON workspace_departments FOR UPDATE
  USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS workspace_departments_delete ON workspace_departments;
CREATE POLICY workspace_departments_delete ON workspace_departments FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON workspace_departments;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON workspace_departments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS workspace_department_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID NOT NULL REFERENCES workspace_departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (department_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_department_members_department
  ON workspace_department_members(department_id);

ALTER TABLE workspace_department_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_department_members_select ON workspace_department_members;
CREATE POLICY workspace_department_members_select ON workspace_department_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM workspace_departments d
    WHERE d.id = workspace_department_members.department_id AND is_account_member(d.account_id)
  ));
DROP POLICY IF EXISTS workspace_department_members_insert ON workspace_department_members;
CREATE POLICY workspace_department_members_insert ON workspace_department_members FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM workspace_departments d
    WHERE d.id = workspace_department_members.department_id AND is_account_member(d.account_id, 'admin')
  ));
DROP POLICY IF EXISTS workspace_department_members_delete ON workspace_department_members;
CREATE POLICY workspace_department_members_delete ON workspace_department_members FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM workspace_departments d
    WHERE d.id = workspace_department_members.department_id AND is_account_member(d.account_id, 'admin')
  ));

-- ============================================================
-- INTERNAL CHAT — department_id NULL means the account-wide
-- "General" channel; a non-null value scopes the message to that
-- department's channel. No edit/delete in this phase — a lightweight
-- team channel, not a full chat product.
-- ============================================================
CREATE TABLE IF NOT EXISTS workspace_internal_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  department_id UUID REFERENCES workspace_departments(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_internal_messages_channel
  ON workspace_internal_messages(account_id, department_id, created_at);

ALTER TABLE workspace_internal_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_internal_messages_select ON workspace_internal_messages;
CREATE POLICY workspace_internal_messages_select ON workspace_internal_messages FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS workspace_internal_messages_insert ON workspace_internal_messages;
CREATE POLICY workspace_internal_messages_insert ON workspace_internal_messages FOR INSERT
  WITH CHECK (is_account_member(account_id) AND sender_id = auth.uid());
