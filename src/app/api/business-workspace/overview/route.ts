import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceLicense } from '@/lib/business-workspace/guard'
import { getWorkspaceOverview } from '@/lib/business-workspace/queries'

/** GET /api/business-workspace/overview — Business Workspace Overview tab. */
export async function GET() {
  try {
    const { supabase, accountId, role, userId } = await getCurrentAccount()
    await requireBusinessWorkspaceLicense(supabase, accountId, role)

    const overview = await getWorkspaceOverview(supabase, accountId, userId)
    return NextResponse.json({ overview })
  } catch (err) {
    return toErrorResponse(err)
  }
}
