import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'

/**
 * GET /api/business-workspace/labels — gate check only. Labels reuses
 * the existing `tags` table/RLS wholesale (same CRUD component as
 * Settings), so there's no separate data query here — this route
 * exists purely so the page can validate role + tenant + feature flag
 * + license before rendering, per the module's "every feature
 * re-checks independently" rule.
 */
export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'labels')
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
