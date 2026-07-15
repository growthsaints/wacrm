-- ============================================================
-- 043_agent_feature_grants.sql — Per-agent feature access
--
-- Broadcasts, Automations, and Templates are admin+ by default —
-- an 'agent' role member can't see or use them unless an owner/admin
-- explicitly grants that specific feature to that specific agent.
-- Owner/admin/viewer are unaffected: owner and admin always have
-- every feature; viewer never gets these regardless of grants (a
-- grant only lifts the 'agent' role's default restriction).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_feature_grants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature    TEXT NOT NULL CHECK (feature IN ('broadcasts', 'automations', 'templates')),
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, user_id, feature)
);

CREATE INDEX IF NOT EXISTS idx_agent_feature_grants_lookup
  ON agent_feature_grants(account_id, user_id);

ALTER TABLE agent_feature_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_feature_grants_select ON agent_feature_grants;
DROP POLICY IF EXISTS agent_feature_grants_insert ON agent_feature_grants;
DROP POLICY IF EXISTS agent_feature_grants_delete ON agent_feature_grants;

-- Admin+ see every grant in their account (to manage them); an agent
-- can see their own grants (so the client can tell what they can do).
CREATE POLICY agent_feature_grants_select ON agent_feature_grants FOR SELECT
  USING (is_account_member(account_id, 'admin') OR user_id = auth.uid());

-- Only admin+ can grant/revoke.
CREATE POLICY agent_feature_grants_insert ON agent_feature_grants FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY agent_feature_grants_delete ON agent_feature_grants FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- has_feature_access — the RLS-side counterpart to requireFeature()
-- (src/lib/auth/account.ts): true for admin+ unconditionally, true
-- for an 'agent' only if a matching grant row exists, false for
-- viewer regardless of grants. Used by the broadcasts and
-- message_templates policies below so an ungranted agent is blocked
-- at the database level too, not just in the app's own routes/UI —
-- both insert directly from the client rather than through a
-- service-role API route.
-- ============================================================
CREATE OR REPLACE FUNCTION has_feature_access(
  target_account_id UUID,
  feature_name TEXT
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    is_account_member(target_account_id, 'admin')
    OR EXISTS (
      SELECT 1 FROM agent_feature_grants g
      WHERE g.account_id = target_account_id
        AND g.user_id = auth.uid()
        AND g.feature = feature_name
    );
$$;

ALTER FUNCTION has_feature_access(UUID, TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION has_feature_access(UUID, TEXT) TO authenticated, service_role;

-- Broadcasts — writes tighten from "any agent+" to "admin+, or an
-- agent with the 'broadcasts' grant". Reads (broadcasts_select)
-- stay as-is; the app hides the page/nav item from ungranted agents,
-- and a read-only view of past campaigns isn't the sensitive part.
DROP POLICY IF EXISTS broadcasts_insert ON broadcasts;
DROP POLICY IF EXISTS broadcasts_update ON broadcasts;
DROP POLICY IF EXISTS broadcasts_delete ON broadcasts;
CREATE POLICY broadcasts_insert ON broadcasts FOR INSERT
  WITH CHECK (has_feature_access(account_id, 'broadcasts'));
CREATE POLICY broadcasts_update ON broadcasts FOR UPDATE
  USING (has_feature_access(account_id, 'broadcasts'));
CREATE POLICY broadcasts_delete ON broadcasts FOR DELETE
  USING (has_feature_access(account_id, 'broadcasts'));

-- Templates — was already admin-only; switching to has_feature_access
-- keeps that for everyone else but opens the door for a granted agent.
DROP POLICY IF EXISTS message_templates_insert ON message_templates;
DROP POLICY IF EXISTS message_templates_update ON message_templates;
DROP POLICY IF EXISTS message_templates_delete ON message_templates;
CREATE POLICY message_templates_insert ON message_templates FOR INSERT
  WITH CHECK (has_feature_access(account_id, 'templates'));
CREATE POLICY message_templates_update ON message_templates FOR UPDATE
  USING (has_feature_access(account_id, 'templates'));
CREATE POLICY message_templates_delete ON message_templates FOR DELETE
  USING (has_feature_access(account_id, 'templates'));
