-- ============================================================
-- 045_enterprise_automation_rules.sql — Campaign Intelligence's own
-- Automation Rules (health/risk-triggered, distinct from the generic
-- top-level Automations feature which triggers on messages/tags/
-- contacts). E.g. "notify me if quality rating drops to Red."
--
-- Scope note: this migration adds rule storage + CRUD. The action a
-- rule takes is limited to creating a Notification (the one thing
-- this codebase can actually execute reliably today) — there is no
-- broadcast pause/resume capability to hook a more dramatic action
-- into (see enterprise queries.ts's Broadcast Queue comment).
-- ============================================================

CREATE TABLE IF NOT EXISTS enterprise_automation_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  condition_type TEXT NOT NULL CHECK (
    condition_type IN ('quality_rating_drops', 'failure_rate_above', 'messaging_tier_downgraded', 'disconnected')
  ),
  condition_value NUMERIC, -- e.g. failure_rate_above threshold (%)
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enterprise_automation_rules_account ON enterprise_automation_rules(account_id);

ALTER TABLE enterprise_automation_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS enterprise_automation_rules_select ON enterprise_automation_rules;
CREATE POLICY enterprise_automation_rules_select ON enterprise_automation_rules FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS enterprise_automation_rules_insert ON enterprise_automation_rules;
CREATE POLICY enterprise_automation_rules_insert ON enterprise_automation_rules FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS enterprise_automation_rules_update ON enterprise_automation_rules;
CREATE POLICY enterprise_automation_rules_update ON enterprise_automation_rules FOR UPDATE
  USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS enterprise_automation_rules_delete ON enterprise_automation_rules;
CREATE POLICY enterprise_automation_rules_delete ON enterprise_automation_rules FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON enterprise_automation_rules;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON enterprise_automation_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
