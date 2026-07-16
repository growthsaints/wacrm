import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { hasModuleAccessGrant } from '@/lib/rbac/module-access-grants'
import {
  getEnterpriseLicense,
  isLicenseActive,
  canAccessEnterpriseModule,
  type EnterpriseFeature,
} from '@/lib/enterprise/features'

/**
 * GET /api/enterprise/features — the calling user's own account's
 * enterprise entitlement. Used by the sidebar to decide whether to
 * show the Enterprise section at all, and by each sub-page to gate
 * itself. Returns `{ enabled: false }` (not a 403) when there's no
 * license, the caller's role doesn't qualify, or (for an admin) the
 * owner hasn't granted them access yet — this is a "should I render
 * this nav item" check, not an authorization boundary; each enterprise
 * API route re-checks independently server-side.
 */
export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()

    if (!canAccessEnterpriseModule(role)) {
      return NextResponse.json({ enabled: false, features: {} })
    }
    if (role === 'admin' && !(await hasModuleAccessGrant(supabase, accountId, 'enterprise'))) {
      return NextResponse.json({ enabled: false, features: {} })
    }

    const license = await getEnterpriseLicense(supabase, accountId)
    const active = isLicenseActive(license)

    return NextResponse.json({
      enabled: active,
      features: active ? license?.features ?? {} : ({} as Record<EnterpriseFeature, boolean>),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
