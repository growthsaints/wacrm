-- ============================================================
-- 093_meta_ad_campaigns_special_ad_category.sql — adds a required-at-
-- the-API-layer Special Ad Category declaration to campaigns.
--
-- Meta requires any Housing/Employment/Credit/Social-Issue ad to
-- self-declare its Special Ad Category on the Campaign object
-- (special_ad_categories) — an undeclared ad in one of these
-- categories is itself a policy violation, independent of anything
-- else about the ad. wacrm's campaign creation previously always sent
-- an empty array with no way for an admin to declare otherwise; this
-- column lets them, defaulting to 'NONE' (today's existing behavior)
-- so nothing changes for any campaign that isn't in a regulated
-- category.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE meta_ad_campaigns
  ADD COLUMN IF NOT EXISTS special_ad_category TEXT NOT NULL DEFAULT 'NONE';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meta_ad_campaigns_special_ad_category_check'
  ) THEN
    ALTER TABLE meta_ad_campaigns
      ADD CONSTRAINT meta_ad_campaigns_special_ad_category_check
      CHECK (special_ad_category IN ('NONE', 'HOUSING', 'EMPLOYMENT', 'CREDIT', 'ISSUES_ELECTIONS_POLITICS'));
  END IF;
END $$;
