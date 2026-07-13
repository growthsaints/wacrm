-- ============================================================
-- 037_platform_admin.sql — Platform-admin layer (Growth Saints SaaS)
--
-- Introduces a super-admin identity distinct from any tenant's
-- `account_role`, plus the minimum schema needed for tenant lifecycle
-- management (suspend / reinstate a client) and an audit trail for
-- "log in as a client" support impersonation.
--
-- Idempotent — safe to run multiple times, mirrors every earlier
-- migration's IF NOT EXISTS / DROP POLICY IF EXISTS conventions.
-- ============================================================

-- ============================================================
-- PLATFORM_ADMINS
--
-- Membership in this table is what makes someone a Growth Saints
-- platform operator. Deliberately separate from `profiles.account_role`
-- — a platform admin is not a member of any particular tenant account,
-- and a tenant account_role never implies platform access.
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(user_id)
);

ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- is_platform_admin() — SECURITY DEFINER helper, mirrors the shape of
-- is_account_member() from 017_account_sharing.sql so every policy
-- below reads the same way as the tenant-side ones.
-- ============================================================
CREATE OR REPLACE FUNCTION is_platform_admin(target_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform_admins pa WHERE pa.user_id = target_user_id
  );
$$;

ALTER FUNCTION is_platform_admin(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_platform_admin(UUID) TO authenticated, service_role;

-- Any authenticated user may read their own row (the cheap "am I a
-- platform admin?" check used by requirePlatformAdmin()); an existing
-- platform admin may read every row (the roster in Settings → Platform
-- admins). One combined policy rather than two — easier to audit.
DROP POLICY IF EXISTS platform_admins_select ON platform_admins;
CREATE POLICY platform_admins_select ON platform_admins FOR SELECT
  USING (auth.uid() = user_id OR is_platform_admin());
-- No INSERT/UPDATE/DELETE policy for `authenticated` — membership is
-- managed only through the service-role client (src/lib/platform/admin-client.ts),
-- itself gated by requirePlatformAdmin() at the route layer.

-- ============================================================
-- ACCOUNTS.status — lifecycle flag for Client management
-- (suspend / reinstate a tenant from the Super Admin dashboard).
-- Defaults to 'active' so every existing account is unaffected.
-- ============================================================
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_status_check'
  ) THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_status_check CHECK (status IN ('active', 'suspended'));
  END IF;
END $$;

-- ============================================================
-- IMPERSONATION_LOG — audit trail for "Login as Client"
--
-- One row per impersonation session. `ended_at` is null while a
-- session is live; the exit endpoint stamps it. Writes are service-
-- role only (start/insert, exit/update) — never client-writable.
-- ============================================================
CREATE TABLE IF NOT EXISTS impersonation_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_admin_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_impersonation_log_account ON impersonation_log(target_account_id);
CREATE INDEX IF NOT EXISTS idx_impersonation_log_admin ON impersonation_log(platform_admin_user_id);

ALTER TABLE impersonation_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS impersonation_log_select ON impersonation_log;
CREATE POLICY impersonation_log_select ON impersonation_log FOR SELECT
  USING (is_platform_admin());

-- ============================================================
-- PLATFORM-ADMIN READ ACCESS ON TENANT TABLES
--
-- Additive permissive SELECT policies. Postgres OR's every permissive
-- policy for the same command together, so these sit ALONGSIDE (never
-- replace) the tenant-scoped policies from 017_account_sharing.sql.
-- This lets the Super Admin dashboard read cross-tenant data through
-- the normal RLS-scoped SSR client instead of the service-role key —
-- narrower blast radius, and every read is subject to the same audit-
-- able policy engine as tenant access.
--
-- `accounts` additionally gets an UPDATE policy so suspend/reinstate
-- (Client management) can go through the RLS-scoped client too.
-- ============================================================
DROP POLICY IF EXISTS accounts_platform_select ON accounts;
CREATE POLICY accounts_platform_select ON accounts FOR SELECT USING (is_platform_admin());

DROP POLICY IF EXISTS accounts_platform_update ON accounts;
CREATE POLICY accounts_platform_update ON accounts FOR UPDATE
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS profiles_platform_select ON profiles;
CREATE POLICY profiles_platform_select ON profiles FOR SELECT USING (is_platform_admin());

DROP POLICY IF EXISTS contacts_platform_select ON contacts;
CREATE POLICY contacts_platform_select ON contacts FOR SELECT USING (is_platform_admin());

DROP POLICY IF EXISTS conversations_platform_select ON conversations;
CREATE POLICY conversations_platform_select ON conversations FOR SELECT USING (is_platform_admin());

DROP POLICY IF EXISTS messages_platform_select ON messages;
CREATE POLICY messages_platform_select ON messages FOR SELECT USING (is_platform_admin());

DROP POLICY IF EXISTS broadcasts_platform_select ON broadcasts;
CREATE POLICY broadcasts_platform_select ON broadcasts FOR SELECT USING (is_platform_admin());

DROP POLICY IF EXISTS whatsapp_config_platform_select ON whatsapp_config;
CREATE POLICY whatsapp_config_platform_select ON whatsapp_config FOR SELECT USING (is_platform_admin());
