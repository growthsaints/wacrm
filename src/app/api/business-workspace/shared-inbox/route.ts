import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { getSharedInbox } from '@/lib/business-workspace/queries'

/** GET /api/business-workspace/shared-inbox — management view over conversations. */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'shared_inbox')

    const url = new URL(request.url)
    const page = Number(url.searchParams.get('page') ?? '0')

    const result = await getSharedInbox(supabase, accountId, {
      status: url.searchParams.get('status') || undefined,
      assignedAgentId: url.searchParams.get('assignedAgent') || undefined,
      pinnedOnly: url.searchParams.get('pinned') === 'true',
      search: url.searchParams.get('search') || undefined,
      page: Number.isFinite(page) && page >= 0 ? page : 0,
    })

    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
