import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { getDealsList } from '@/lib/business-workspace/queries'

/** GET /api/business-workspace/deals — flat, filterable deal list across every stage. */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'deals')

    const url = new URL(request.url)
    const page = Number(url.searchParams.get('page') ?? '0')

    const result = await getDealsList(supabase, accountId, {
      search: url.searchParams.get('search') || undefined,
      status: url.searchParams.get('status') || undefined,
      assignedToId: url.searchParams.get('assignedTo') || undefined,
      page: Number.isFinite(page) && page >= 0 ? page : 0,
    })

    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
