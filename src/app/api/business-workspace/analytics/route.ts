import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { getWorkspaceAnalytics } from '@/lib/business-workspace/queries'

/** GET /api/business-workspace/analytics */
export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'analytics')

    const analytics = await getWorkspaceAnalytics(supabase, accountId)
    return NextResponse.json({ analytics })
  } catch (err) {
    return toErrorResponse(err)
  }
}
