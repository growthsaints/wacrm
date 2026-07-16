import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountRole } from '@/lib/auth/roles'
import { ForbiddenError } from '@/lib/auth/account'
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
 * Server-side gate for every Campaign Intelligence API route — checks
 * role, license status, AND the specific feature flag, per the spec's
 * "Every API must validate Role, Tenant, Feature Flag, Enterprise
 * License" requirement. Throws ForbiddenError (never just relies on
 * the sidebar hiding the nav item) when any check fails.
 */
export async function requireEnterpriseFeature(
  supabase: SupabaseClient,
  accountId: string,
  role: AccountRole,
  feature: EnterpriseFeature,
): Promise<void> {
  if (!canAccessEnterpriseModule(role)) {
    throw new ForbiddenError('This feature requires an Owner or Admin role')
  }
  const license = await getEnterpriseLicense(supabase, accountId)
  if (!hasEnterpriseFeature(license, feature)) {
    throw new ForbiddenError('This feature is not enabled for your account')
  }
}
