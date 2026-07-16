import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountRole } from '@/lib/auth/roles'
import { ForbiddenError } from '@/lib/auth/account'
import { hasModuleAccessGrant } from '@/lib/rbac/module-access-grants'
import {
  canAccessEnterpriseModule,
  getEnterpriseLicense,
  hasEnterpriseFeature,
  type EnterpriseFeature,
} from '@/lib/enterprise/features'

// Split from features.ts (which is also imported by client components
// for its pure helpers/constants) because `@/lib/auth/account` pulls in
// next/headers — importing it anywhere client-reachable breaks the
// build. API routes only — never import this file from a client
// component or anything a client component imports.

/**
 * Owner always passes; an admin only passes once the account owner
 * has explicitly granted them Enterprise access (module_access_grants,
 * migration 053) — the RBAC nuance documented since this module's
 * original scoping ("Admin: no access by default, enable manually").
 */
async function requireModuleRole(supabase: SupabaseClient, accountId: string, role: AccountRole): Promise<void> {
  if (!canAccessEnterpriseModule(role)) {
    throw new ForbiddenError('This feature requires an Owner or Admin role')
  }
  if (role === 'admin') {
    const granted = await hasModuleAccessGrant(supabase, accountId, 'enterprise')
    if (!granted) {
      throw new ForbiddenError("Enterprise access hasn't been granted to your admin account yet — ask the account owner.")
    }
  }
}

/**
 * Server-side gate for every Campaign Intelligence API route — checks
 * role (+ per-admin grant), license status, AND the specific feature
 * flag, per the spec's "Every API must validate Role, Tenant, Feature
 * Flag, Enterprise License" requirement. Throws ForbiddenError (never
 * just relies on the sidebar hiding the nav item) when any check fails.
 */
export async function requireEnterpriseFeature(
  supabase: SupabaseClient,
  accountId: string,
  role: AccountRole,
  feature: EnterpriseFeature,
): Promise<void> {
  await requireModuleRole(supabase, accountId, role)
  const license = await getEnterpriseLicense(supabase, accountId)
  if (!hasEnterpriseFeature(license, feature)) {
    throw new ForbiddenError('This feature is not enabled for your account')
  }
}
