-- ============================================================
-- 092_meta_ad_campaigns_headline.sql — adds an optional headline +
-- description to image/video-format campaigns (carousel already has
-- its own per-card headline/description in carousel_cards).
--
-- Ground-truth confirmed against this account's own ad account: a
-- classic link_data creative accepts `name` (headline) and
-- `description`; a classic video_data creative accepts `title`
-- (headline) — video has no separate description field, so the
-- `description` column is simply unused for ad_format='video'.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE meta_ad_campaigns
  ADD COLUMN IF NOT EXISTS headline TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;
