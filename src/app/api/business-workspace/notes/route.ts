import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { getNotesList } from '@/lib/business-workspace/queries'

/** GET /api/business-workspace/notes — account-wide notes list, searchable. */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'notes')

    const url = new URL(request.url)
    const page = Number(url.searchParams.get('page') ?? '0')

    const result = await getNotesList(supabase, accountId, {
      search: url.searchParams.get('search') || undefined,
      page: Number.isFinite(page) && page >= 0 ? page : 0,
    })

    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
