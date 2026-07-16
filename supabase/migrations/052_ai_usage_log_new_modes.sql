-- ============================================================
-- 052_ai_usage_log_new_modes.sql — widen ai_usage_log.mode to cover
-- Campaign Intelligence's AI Recommendations and Business Workspace's
-- AI Assistant, both of which already call generateReply() but
-- weren't logging usage anywhere — so both modules' Analytics pages
-- showed "AI Usage: not tracked" even though the real ai_usage_log
-- table (migration 033) has existed the whole time for the tenant's
-- own AI Agent (auto-reply/draft). This is purely additive: existing
-- rows and the auto_reply/draft modes are untouched.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- Find whatever Postgres auto-named the original inline CHECK
-- constraint (migration 033 didn't name it explicitly) rather than
-- guessing — a wrong guess would leave the old, narrower constraint
-- in place alongside a new one, and the narrower one would still
-- reject the new mode values.
DO $$
DECLARE
  existing_constraint_name text;
BEGIN
  SELECT con.conname INTO existing_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'ai_usage_log'
    AND con.contype = 'c'
    AND att.attname = 'mode';

  IF existing_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ai_usage_log DROP CONSTRAINT %I', existing_constraint_name);
  END IF;
END $$;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'enterprise_recommendations', 'workspace_assistant'));
