-- ============================================================
-- 090_meta_ad_campaigns_formats.sql — Meta Ads: video and carousel
-- creative formats, alongside the existing single-image format.
--
-- Ground-truth confirmed against real objects in this account's own
-- Ads Manager (a manually-built video ad and carousel ad), same
-- process as the original image-format Phase 2 work:
--   - Video creative: classic object_story_spec.video_data
--     {video_id, image_url (thumbnail), message, call_to_action}.
--   - Carousel creative: object_story_spec.link_data.child_attachments,
--     an array of {link, image_hash, name, description} — confirmed
--     to exactly match what Meta's own Ads Manager UI produces for a
--     real carousel ad in this account.
--   - Video upload: POST /act_<id>/advideos accepts a plain
--     `file_url` (Meta fetches it server-side) — no resumable/chunked
--     upload needed at this scale. Processing is asynchronous; the
--     launch flow polls the video's `status.video_status` until
--     'ready' before referencing it in a creative.
--
-- `image_url` (single-image format) is unchanged; `video_url` and
-- `carousel_cards` are new, alongside `ad_format` selecting which one
-- applies. Exactly one of the three is populated depending on
-- ad_format — enforced in application code, not a DB constraint,
-- since expressing "exactly one of three JSON shapes" cleanly in SQL
-- isn't worth the complexity here.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE meta_ad_campaigns
  ADD COLUMN IF NOT EXISTS ad_format TEXT NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS video_url TEXT,
  ADD COLUMN IF NOT EXISTS carousel_cards JSONB;

ALTER TABLE meta_ad_campaigns DROP CONSTRAINT IF EXISTS meta_ad_campaigns_ad_format_check;
ALTER TABLE meta_ad_campaigns ADD CONSTRAINT meta_ad_campaigns_ad_format_check
  CHECK (ad_format IN ('image', 'video', 'carousel'));
