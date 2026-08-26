-- ============================================================
-- 085_sms_feature_grant.sql — gate Settings → SMS / httpSMS behind
-- the same per-agent feature-grant mechanism as Broadcasts/
-- Automations/Templates (migration 043).
--
-- 'sms' covers BOTH the SMS Gateway and httpSMS settings sections —
-- one toggle in Members → Manage access rather than two, since an
-- account either wants a given agent configuring/using SMS channels
-- or it doesn't; the two providers aren't meaningfully different
-- access decisions for a team-permissions purpose.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE agent_feature_grants DROP CONSTRAINT IF EXISTS agent_feature_grants_feature_check;
ALTER TABLE agent_feature_grants ADD CONSTRAINT agent_feature_grants_feature_check
  CHECK (feature IN ('broadcasts', 'automations', 'templates', 'sms'));
