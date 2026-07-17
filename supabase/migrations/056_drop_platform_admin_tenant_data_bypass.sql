-- ============================================================
-- 056_drop_platform_admin_tenant_data_bypass.sql
--
-- Fixes a cross-account data leak: any platform admin could see every
-- tenant's contacts, conversations, messages, broadcasts, and
-- whatsapp_config rows on their OWN regular account pages, not just
-- in the dedicated Super Admin tools.
--
-- Root cause: migration 037 added a `<table>_platform_select` RLS
-- policy on each of these tables (`USING (is_platform_admin())`), so
-- a platform admin's normal tenant-side session already satisfied the
-- policy for every row, everywhere, permanently — RLS has no notion
-- of "which screen is this admin using right now." Postgres combines
-- multiple permissive SELECT policies with OR, so this bypass applied
-- alongside the correct `is_account_member(account_id)` policy on
-- every single query against these tables, including the plain
-- `.select('*')` the regular /contacts, /inbox, /broadcasts pages run
-- with no account_id filter of their own (they rely entirely on RLS
-- to scope the result) — so a platform admin's own account pages
-- silently returned every tenant's rows mixed in.
--
-- The legitimate cross-tenant reads this policy enabled — the Super
-- Admin overview's global counts, and the Super Admin "WhatsApp
-- Numbers" page — have been moved to the service-role client
-- (platformAdminClient()) in api/platform/overview, api/platform/
-- whatsapp, and api/platform/whatsapp/reconcile, which needs no RLS
-- grant at all. Nothing else in the app reads these five tables via
-- the RLS-scoped client expecting cross-account visibility, so the
-- policies can simply be dropped.
--
-- `accounts_platform_select` and `profiles_platform_select` are
-- intentionally left in place — the roster/organization-list screens
-- that need them (Settings -> Platform admins, Platform ->
-- Organizations) don't have a plain-tenant-page equivalent that would
-- leak the same way, and narrowing those is a separate, lower-urgency
-- cleanup.
--
-- Idempotent — DROP POLICY IF EXISTS is a no-op if already applied.
-- ============================================================

DROP POLICY IF EXISTS contacts_platform_select ON contacts;
DROP POLICY IF EXISTS conversations_platform_select ON conversations;
DROP POLICY IF EXISTS messages_platform_select ON messages;
DROP POLICY IF EXISTS broadcasts_platform_select ON broadcasts;
DROP POLICY IF EXISTS whatsapp_config_platform_select ON whatsapp_config;
