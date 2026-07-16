import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { getCustomerHub } from '@/lib/business-workspace/queries'

/** GET /api/business-workspace/customer-hub — filtered, paginated customer list. */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'customer_hub')

    const url = new URL(request.url)
    const page = Number(url.searchParams.get('page') ?? '0')

    const result = await getCustomerHub(supabase, accountId, {
      search: url.searchParams.get('search') || undefined,
      source: url.searchParams.get('source') || undefined,
      priority: url.searchParams.get('priority') || undefined,
      workspaceStatus: url.searchParams.get('status') || undefined,
      segment: url.searchParams.get('segment') || undefined,
      tagId: url.searchParams.get('tag') || undefined,
      assignedAgentId: url.searchParams.get('assignedAgent') || undefined,
      page: Number.isFinite(page) && page >= 0 ? page : 0,
    })

    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
