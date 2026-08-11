-- ============================================================
-- 063_plan_free_granted.sql — distinguishes "Super Admin explicitly
-- comped this account" from "never subscribed" (both otherwise read
-- as plan_type = 'none'). Needed so the trial-expiry banner (see
-- /api/billing/plan) can tell a genuinely-comped account apart from
-- one that just hasn't paid yet.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS plan_free_granted BOOLEAN NOT NULL DEFAULT false;
