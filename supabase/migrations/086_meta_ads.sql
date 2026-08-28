-- ============================================================
-- 086_meta_ads.sql — Meta Ads integration, Phase 1: connect an ad
-- account (BYO access token, same trust model as ai_configs /
-- httpsms_config — every account supplies its own credential, wacrm
-- never holds a shared/pooled one) and build Custom Audiences from
-- CRM contact segments for retargeting via Meta ads.
--
-- Design notes
--   - `meta_ads_config`: one connected ad account per wacrm account
--     for now (UNIQUE(account_id)) — an account can reconnect to
--     swap which ad account is linked, but not run two in parallel
--     yet. `access_token` is a Meta System User access token (the
--     manual Business Settings flow, not an OAuth dialog — Meta's
--     Marketing API only grants third-party OAuth access at Advanced
--     Access, which requires an App Review this app doesn't have yet;
--     a manually-generated System User token works today for any
--     account willing to add this app as a Business partner).
--   - `meta_custom_audiences`: one row per CRM-segment-to-Meta-
--     audience sync. `audience_filter` mirrors broadcasts'
--     `audience_filter` JSONB shape (all/tags/custom_field/csv) so
--     the same segment-resolution code can be reused. `meta_audience_id`
--     is null until the Meta-side object is actually created.
--
-- RLS: settings-class, identical shape to notification_rules/
-- webhook_endpoints — any member can read, only admin+ can write.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS meta_ads_config (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ad_account_id  TEXT NOT NULL,              -- Meta's "act_<id>" form
  business_id    TEXT,
  access_token   TEXT NOT NULL,              -- AES-256-GCM encrypted, same primitive as whatsapp/ai
  connected_name TEXT,                       -- ad account display name, from Meta, for the Settings UI
  currency       TEXT,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id)
);

CREATE TABLE IF NOT EXISTS meta_custom_audiences (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  meta_ads_config_id UUID NOT NULL REFERENCES meta_ads_config(id) ON DELETE CASCADE,
  meta_audience_id  TEXT,                    -- Meta's Custom Audience id, set once created
  name              TEXT NOT NULL,
  audience_filter   JSONB NOT NULL DEFAULT '{}'::jsonb,
  contact_count     INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'creating', 'ready', 'failed')),
  error_message     TEXT,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_custom_audiences_account
  ON meta_custom_audiences(account_id);

ALTER TABLE meta_ads_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_custom_audiences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_ads_config_select ON meta_ads_config;
CREATE POLICY meta_ads_config_select ON meta_ads_config FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS meta_ads_config_insert ON meta_ads_config;
CREATE POLICY meta_ads_config_insert ON meta_ads_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_ads_config_update ON meta_ads_config;
CREATE POLICY meta_ads_config_update ON meta_ads_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_ads_config_delete ON meta_ads_config;
CREATE POLICY meta_ads_config_delete ON meta_ads_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_custom_audiences_select ON meta_custom_audiences;
CREATE POLICY meta_custom_audiences_select ON meta_custom_audiences FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS meta_custom_audiences_insert ON meta_custom_audiences;
CREATE POLICY meta_custom_audiences_insert ON meta_custom_audiences FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_custom_audiences_update ON meta_custom_audiences;
CREATE POLICY meta_custom_audiences_update ON meta_custom_audiences FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_custom_audiences_delete ON meta_custom_audiences;
CREATE POLICY meta_custom_audiences_delete ON meta_custom_audiences FOR DELETE
  USING (is_account_member(account_id, 'admin'));
