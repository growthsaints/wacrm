import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { deleteScheduledItem, updateScheduledItem } from '@/lib/business-workspace/queries'

/** PATCH /api/business-workspace/followup-center/[itemId] — update status/title/due date/priority/agent. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'followup_center')
    const { itemId } = await params

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    await updateScheduledItem(supabase, accountId, itemId, {
      status: typeof body.status === 'string' ? body.status : undefined,
      title: typeof body.title === 'string' ? body.title : undefined,
      dueAt: typeof body.dueAt === 'string' ? body.dueAt : undefined,
      priority: 'priority' in body ? (body.priority as string | null) : undefined,
      assignedToId: 'assignedToId' in body ? (body.assignedToId as string | null) : undefined,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/business-workspace/followup-center/[itemId] */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'followup_center')
    const { itemId } = await params

    await deleteScheduledItem(supabase, accountId, itemId)
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
