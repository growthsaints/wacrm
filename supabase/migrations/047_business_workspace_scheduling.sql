-- ============================================================
-- 047_business_workspace_scheduling.sql — Follow-up Center + Calendar
-- + Campaign Planner storage for Business Workspace.
--
-- One shared "scheduled item" table backs both Follow-up Center
-- (type IN follow_up/reminder/task) and Calendar (every type, viewed
-- by due date) — the spec's own field lists for the two pages overlap
-- almost entirely (assign/priority/status/due date/recurring), so a
-- second parallel table would just be the same rows twice.
--
-- Campaign Planner gets its own table since its shape (audience
-- segment, content draft, checklist, approval status) doesn't overlap
-- with scheduled items at all. Per the explicit spec constraint, this
-- table is planning-only — nothing here can trigger an actual send;
-- there is no column or code path that connects a plan to
-- broadcasts/messages.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_scheduled_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'follow_up'
    CHECK (item_type IN ('meeting', 'appointment', 'callback', 'task', 'follow_up', 'event', 'birthday', 'reminder')),
  due_at TIMESTAMPTZ NOT NULL,
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  priority TEXT CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_scheduled_items_account_due
  ON workspace_scheduled_items(account_id, due_at);
CREATE INDEX IF NOT EXISTS idx_workspace_scheduled_items_contact
  ON workspace_scheduled_items(contact_id);

ALTER TABLE workspace_scheduled_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_scheduled_items_select ON workspace_scheduled_items;
CREATE POLICY workspace_scheduled_items_select ON workspace_scheduled_items FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS workspace_scheduled_items_insert ON workspace_scheduled_items;
CREATE POLICY workspace_scheduled_items_insert ON workspace_scheduled_items FOR INSERT
  WITH CHECK (is_account_member(account_id));

DROP POLICY IF EXISTS workspace_scheduled_items_update ON workspace_scheduled_items;
CREATE POLICY workspace_scheduled_items_update ON workspace_scheduled_items FOR UPDATE
  USING (is_account_member(account_id)) WITH CHECK (is_account_member(account_id));

DROP POLICY IF EXISTS workspace_scheduled_items_delete ON workspace_scheduled_items;
CREATE POLICY workspace_scheduled_items_delete ON workspace_scheduled_items FOR DELETE
  USING (is_account_member(account_id));

DROP TRIGGER IF EXISTS set_updated_at ON workspace_scheduled_items;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON workspace_scheduled_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- WORKSPACE_CAMPAIGN_PLANS — planning only. No column here can
-- trigger a send; "Reports"/status are purely descriptive of the
-- planning workflow (draft -> in_review -> approved -> scheduled ->
-- completed), not an execution engine.
-- ============================================================
CREATE TABLE IF NOT EXISTS workspace_campaign_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  audience_segment TEXT,
  content_draft TEXT,
  media_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_review', 'approved', 'scheduled', 'completed', 'cancelled')),
  planning_date DATE,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_campaign_plans_account
  ON workspace_campaign_plans(account_id, created_at DESC);

ALTER TABLE workspace_campaign_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_campaign_plans_select ON workspace_campaign_plans;
CREATE POLICY workspace_campaign_plans_select ON workspace_campaign_plans FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS workspace_campaign_plans_insert ON workspace_campaign_plans;
CREATE POLICY workspace_campaign_plans_insert ON workspace_campaign_plans FOR INSERT
  WITH CHECK (is_account_member(account_id));

DROP POLICY IF EXISTS workspace_campaign_plans_update ON workspace_campaign_plans;
CREATE POLICY workspace_campaign_plans_update ON workspace_campaign_plans FOR UPDATE
  USING (is_account_member(account_id)) WITH CHECK (is_account_member(account_id));

DROP POLICY IF EXISTS workspace_campaign_plans_delete ON workspace_campaign_plans;
CREATE POLICY workspace_campaign_plans_delete ON workspace_campaign_plans FOR DELETE
  USING (is_account_member(account_id));

DROP TRIGGER IF EXISTS set_updated_at ON workspace_campaign_plans;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON workspace_campaign_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
