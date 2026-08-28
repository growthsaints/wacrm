-- ============================================================
-- 087_meta_ad_campaigns.sql — Meta Ads Phase 2: launching a
-- Click-to-WhatsApp campaign (campaign → ad set → creative → ad),
-- confirmed against a real campaign built in this account's own Ads
-- Manager rather than guessed (objective OUTCOME_ENGAGEMENT,
-- destination_type WHATSAPP, optimization_goal CONVERSATIONS,
-- promoted_object keyed by a connected Facebook Page — see
-- lib/meta-ads/client.ts's header comment for the one field that's
-- still a best-effort, not ground-truth-verified, guess).
--
-- Design notes
--   - Every row wacrm creates on Meta is launched PAUSED — see
--     lib/meta-ads/launch.ts. `status` here tracks wacrm's own
--     record of that, refreshed on demand, not a live subscription;
--     an admin activating/pausing directly in Ads Manager won't be
--     reflected here until the row is refreshed.
--   - `page_id` is the Facebook Page whose linked WhatsApp number
--     receives the resulting conversations — Meta ties WhatsApp
--     destination to a Page, not a phone number field on the ad
--     itself.
--   - budget stored as NUMERIC to match `deals.value`'s decimal-safe
--     convention rather than integer minor units.
--
-- RLS: settings-class, identical shape to meta_custom_audiences.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS meta_ad_campaigns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  meta_ads_config_id  UUID NOT NULL REFERENCES meta_ads_config(id) ON DELETE CASCADE,
  custom_audience_id  UUID REFERENCES meta_custom_audiences(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  page_id             TEXT NOT NULL,
  page_name           TEXT,
  daily_budget        NUMERIC(12,2) NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'INR',
  primary_text        TEXT NOT NULL,
  image_url           TEXT,
  meta_campaign_id    TEXT,
  meta_adset_id       TEXT,
  meta_creative_id    TEXT,
  meta_ad_id          TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'launching', 'paused', 'failed')),
  error_message       TEXT,
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_ad_campaigns_account
  ON meta_ad_campaigns(account_id);

ALTER TABLE meta_ad_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_ad_campaigns_select ON meta_ad_campaigns;
CREATE POLICY meta_ad_campaigns_select ON meta_ad_campaigns FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS meta_ad_campaigns_insert ON meta_ad_campaigns;
CREATE POLICY meta_ad_campaigns_insert ON meta_ad_campaigns FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_ad_campaigns_update ON meta_ad_campaigns;
CREATE POLICY meta_ad_campaigns_update ON meta_ad_campaigns FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_ad_campaigns_delete ON meta_ad_campaigns;
CREATE POLICY meta_ad_campaigns_delete ON meta_ad_campaigns FOR DELETE
  USING (is_account_member(account_id, 'admin'));
