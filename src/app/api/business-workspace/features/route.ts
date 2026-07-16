import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import {
  getBusinessWorkspaceLicense,
  isLicenseActive,
  canAccessBusinessWorkspace,
  type BusinessWorkspaceFeature,
} from '@/lib/business-workspace/features'

/**
 * GET /api/business-workspace/features — the calling user's own
 * account's Business Workspace entitlement. Used by the sidebar to
 * decide whether to show the section at all, and by each sub-page to
 * gate itself. Returns `{ enabled: false }` (not a 403) when there's
 * no license or the caller's role doesn't qualify — each Business
 * Workspace API route re-checks independently server-side.
 */
export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()

    if (!canAccessBusinessWorkspace(role)) {
      return NextResponse.json({ enabled: false, features: {} })
    }

    const license = await getBusinessWorkspaceLicense(supabase, accountId)
    const active = isLicenseActive(license)

    return NextResponse.json({
      enabled: active,
      features: active ? license?.features ?? {} : ({} as Record<BusinessWorkspaceFeature, boolean>),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
