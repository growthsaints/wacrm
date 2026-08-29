-- ============================================================
-- 091_meta_ads_access_grants.sql — Meta Ads is owner-only by default
-- (unlike most of the app, which is gated at admin+) since it can
-- spend a connected client's ad budget — an owner must explicitly
-- grant per-member access to anyone else (admin, agent, or viewer)
-- who should be able to use it. This is a new, separate grant table
-- rather than reusing agent_feature_grants (admin+ always passes,
-- only ever lifts 'agent') or module_access_grants (same admin+
-- floor) — neither matches "owner-only by default, grantable to any
-- non-owner role."
--
-- No `feature` column — this table is single-purpose (Meta Ads only),
-- so a granted row's mere existence is the grant.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS meta_ads_access_grants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_access_grants_account
  ON meta_ads_access_grants(account_id);

ALTER TABLE meta_ads_access_grants ENABLE ROW LEVEL SECURITY;

-- Owners see every grant on their account; anyone else can only see
-- their own row (so a granted agent/admin/viewer can tell they have
-- access, without seeing who else does).
DROP POLICY IF EXISTS meta_ads_access_grants_select ON meta_ads_access_grants;
CREATE POLICY meta_ads_access_grants_select ON meta_ads_access_grants FOR SELECT
  USING (is_account_member(account_id, 'owner') OR user_id = auth.uid());

DROP POLICY IF EXISTS meta_ads_access_grants_insert ON meta_ads_access_grants;
CREATE POLICY meta_ads_access_grants_insert ON meta_ads_access_grants FOR INSERT
  WITH CHECK (is_account_member(account_id, 'owner'));

DROP POLICY IF EXISTS meta_ads_access_grants_delete ON meta_ads_access_grants;
CREATE POLICY meta_ads_access_grants_delete ON meta_ads_access_grants FOR DELETE
  USING (is_account_member(account_id, 'owner'));

-- ---- has_meta_ads_access() — the single predicate every Meta Ads
-- table's RLS now uses, replacing the settings-class "viewer+ can
-- read, admin+ can write" pattern those tables (086/087) launched
-- with. SECURITY DEFINER for the same reason as is_account_member —
-- reads meta_ads_access_grants without recursive RLS evaluation.
CREATE OR REPLACE FUNCTION has_meta_ads_access(target_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_account_member(target_account_id, 'owner')
    OR EXISTS (
      SELECT 1 FROM meta_ads_access_grants
      WHERE account_id = target_account_id AND user_id = auth.uid()
    );
$$;

GRANT EXECUTE ON FUNCTION has_meta_ads_access(UUID) TO authenticated, service_role;

-- ---- Tighten meta_ads_config / meta_custom_audiences / meta_ad_campaigns
-- RLS to the new owner-or-granted model (was viewer+ select / admin+
-- write) — the whole feature, not just write actions, is now hidden
-- from anyone without owner role or an explicit grant.
DROP POLICY IF EXISTS meta_ads_config_select ON meta_ads_config;
CREATE POLICY meta_ads_config_select ON meta_ads_config FOR SELECT
  USING (has_meta_ads_access(account_id));
DROP POLICY IF EXISTS meta_ads_config_insert ON meta_ads_config;
CREATE POLICY meta_ads_config_insert ON meta_ads_config FOR INSERT
  WITH CHECK (has_meta_ads_access(account_id));
DROP POLICY IF EXISTS meta_ads_config_update ON meta_ads_config;
CREATE POLICY meta_ads_config_update ON meta_ads_config FOR UPDATE
  USING (has_meta_ads_access(account_id));
DROP POLICY IF EXISTS meta_ads_config_delete ON meta_ads_config;
CREATE POLICY meta_ads_config_delete ON meta_ads_config FOR DELETE
  USING (has_meta_ads_access(account_id));

DROP POLICY IF EXISTS meta_custom_audiences_select ON meta_custom_audiences;
CREATE POLICY meta_custom_audiences_select ON meta_custom_audiences FOR SELECT
  USING (has_meta_ads_access(account_id));
DROP POLICY IF EXISTS meta_custom_audiences_insert ON meta_custom_audiences;
CREATE POLICY meta_custom_audiences_insert ON meta_custom_audiences FOR INSERT
  WITH CHECK (has_meta_ads_access(account_id));
DROP POLICY IF EXISTS meta_custom_audiences_update ON meta_custom_audiences;
CREATE POLICY meta_custom_audiences_update ON meta_custom_audiences FOR UPDATE
  USING (has_meta_ads_access(account_id));
DROP POLICY IF EXISTS meta_custom_audiences_delete ON meta_custom_audiences;
CREATE POLICY meta_custom_audiences_delete ON meta_custom_audiences FOR DELETE
  USING (has_meta_ads_access(account_id));

DROP POLICY IF EXISTS meta_ad_campaigns_select ON meta_ad_campaigns;
CREATE POLICY meta_ad_campaigns_select ON meta_ad_campaigns FOR SELECT
  USING (has_meta_ads_access(account_id));
DROP POLICY IF EXISTS meta_ad_campaigns_insert ON meta_ad_campaigns;
CREATE POLICY meta_ad_campaigns_insert ON meta_ad_campaigns FOR INSERT
  WITH CHECK (has_meta_ads_access(account_id));
DROP POLICY IF EXISTS meta_ad_campaigns_update ON meta_ad_campaigns;
CREATE POLICY meta_ad_campaigns_update ON meta_ad_campaigns FOR UPDATE
  USING (has_meta_ads_access(account_id));
DROP POLICY IF EXISTS meta_ad_campaigns_delete ON meta_ad_campaigns;
CREATE POLICY meta_ad_campaigns_delete ON meta_ad_campaigns FOR DELETE
  USING (has_meta_ads_access(account_id));
