-- ============================================================
-- 050_enterprise_account_health_history.sql — daily Health Score
-- snapshots for Campaign Intelligence's Account Health trend chart.
--
-- One row per account per day (upserted by a new cron endpoint,
-- /api/enterprise/account-health/cron, reusing the existing
-- ENTERPRISE_CRON_SECRET from migration 045 — no new env var needed).
-- History starts accumulating from whenever the cron is first wired
-- up; there is no way to backfill scores for days before that, and
-- the UI says so rather than fabricating a flat line.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS enterprise_account_health_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  score INTEGER NOT NULL,
  quality_rating TEXT,
  failure_rate NUMERIC,
  reply_rate NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_enterprise_account_health_history_account
  ON enterprise_account_health_history(account_id, snapshot_date DESC);

ALTER TABLE enterprise_account_health_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS enterprise_account_health_history_select ON enterprise_account_health_history;
CREATE POLICY enterprise_account_health_history_select ON enterprise_account_health_history FOR SELECT
  USING (is_account_member(account_id) OR is_platform_admin());

-- Writes only via the service-role client in the cron route — no
-- client INSERT/UPDATE policy.
