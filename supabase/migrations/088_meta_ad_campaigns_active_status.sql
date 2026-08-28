-- ============================================================
-- 088_meta_ad_campaigns_active_status.sql — lets a launched
-- campaign be marked 'active' once it's been turned on from inside
-- wacrm (see POST /api/meta-ads/campaigns/[id]/status), instead of
-- only ever reflecting the PAUSED state it's created in.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE meta_ad_campaigns DROP CONSTRAINT IF EXISTS meta_ad_campaigns_status_check;
ALTER TABLE meta_ad_campaigns ADD CONSTRAINT meta_ad_campaigns_status_check
  CHECK (status IN ('draft', 'launching', 'paused', 'active', 'failed'));
