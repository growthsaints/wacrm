import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { getTeamWorkspace } from '@/lib/business-workspace/queries'

/** GET /api/business-workspace/team-workspace — roster, presence, weekly performance. */
export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'team_workspace')

    const result = await getTeamWorkspace(supabase, accountId)
    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
