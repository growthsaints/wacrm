import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { getScheduledItems } from '@/lib/business-workspace/queries'

/**
 * GET /api/business-workspace/calendar — every scheduled item type
 * (meetings, appointments, callbacks, events, birthdays, reminders,
 * tasks, follow-ups) within a date range. Read-only view over the
 * same table Follow-up Center manages — create/edit/delete happens
 * there.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'calendar')

    const url = new URL(request.url)
    const result = await getScheduledItems(supabase, accountId, {
      fromDate: url.searchParams.get('from') || undefined,
      toDate: url.searchParams.get('to') || undefined,
      pageSize: 200,
    })

    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
