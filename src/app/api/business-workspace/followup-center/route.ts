import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { createScheduledItem, getScheduledItems, type ScheduledItemType } from '@/lib/business-workspace/queries'

const ITEM_TYPES: ScheduledItemType[] = ['meeting', 'appointment', 'callback', 'task', 'follow_up', 'event', 'birthday', 'reminder']

/** GET /api/business-workspace/followup-center — reminders/tasks/follow-ups list. */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'followup_center')

    const url = new URL(request.url)
    const page = Number(url.searchParams.get('page') ?? '0')

    const result = await getScheduledItems(supabase, accountId, {
      types: ['follow_up', 'reminder', 'task'],
      status: url.searchParams.get('status') || undefined,
      page: Number.isFinite(page) && page >= 0 ? page : 0,
    })

    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST /api/business-workspace/followup-center — create a reminder/task/follow-up (or any scheduled item type). */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, role, userId } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'followup_center')

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const itemType = typeof body.itemType === 'string' ? body.itemType : 'follow_up'
    const dueAt = typeof body.dueAt === 'string' ? body.dueAt : ''
    if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    if (!ITEM_TYPES.includes(itemType as ScheduledItemType)) {
      return NextResponse.json({ error: 'Invalid item type' }, { status: 400 })
    }
    if (!dueAt || Number.isNaN(new Date(dueAt).getTime())) {
      return NextResponse.json({ error: 'A valid due date is required' }, { status: 400 })
    }

    const item = await createScheduledItem(supabase, accountId, userId, {
      title,
      itemType: itemType as ScheduledItemType,
      dueAt,
      isRecurring: body.isRecurring === true,
      priority: typeof body.priority === 'string' ? body.priority : null,
      assignedToId: typeof body.assignedToId === 'string' ? body.assignedToId : null,
      contactId: typeof body.contactId === 'string' ? body.contactId : null,
      notes: typeof body.notes === 'string' ? body.notes : null,
    })

    return NextResponse.json({ item })
  } catch (err) {
    return toErrorResponse(err)
  }
}
