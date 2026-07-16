import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountRole } from '@/lib/auth/roles'
import { ForbiddenError } from '@/lib/auth/account'
import {
  canAccessBusinessWorkspace,
  getBusinessWorkspaceLicense,
  hasBusinessWorkspaceFeature,
  isLicenseActive,
  type BusinessWorkspaceFeature,
} from '@/lib/business-workspace/features'

// Split from features.ts (also imported by client components for its
// pure helpers/constants) because `@/lib/auth/account` pulls in
// next/headers — importing it anywhere client-reachable breaks the
// build. API routes only — never import this file from a client
// component or anything a client component imports.

/**
 * Server-side gate for every Business Workspace API route — checks
 * role, license status, AND the specific feature flag. Throws
 * ForbiddenError (never just relies on the sidebar hiding the nav
 * item) when any check fails.
 */
export async function requireBusinessWorkspaceFeature(
  supabase: SupabaseClient,
  accountId: string,
  role: AccountRole,
  feature: BusinessWorkspaceFeature,
): Promise<void> {
  if (!canAccessBusinessWorkspace(role)) {
    throw new ForbiddenError('This feature requires an Owner or Admin role')
  }
  const license = await getBusinessWorkspaceLicense(supabase, accountId)
  if (!hasBusinessWorkspaceFeature(license, feature)) {
    throw new ForbiddenError('This feature is not enabled for your account')
  }
}

/**
 * Gate for the module's Overview — active license + role only, no
 * specific sub-feature required (Overview isn't behind its own flag;
 * it rides along with the master switch, mirroring Campaign
 * Intelligence's Overview).
 */
export async function requireBusinessWorkspaceLicense(
  supabase: SupabaseClient,
  accountId: string,
  role: AccountRole,
): Promise<void> {
  if (!canAccessBusinessWorkspace(role)) {
    throw new ForbiddenError('This feature requires an Owner or Admin role')
  }
  const license = await getBusinessWorkspaceLicense(supabase, accountId)
  if (!isLicenseActive(license)) {
    throw new ForbiddenError('Business Workspace is not enabled for your account')
  }
}
