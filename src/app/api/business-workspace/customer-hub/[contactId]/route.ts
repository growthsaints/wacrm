import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { updateCustomerWorkspaceFields } from '@/lib/business-workspace/queries'

/**
 * PATCH /api/business-workspace/customer-hub/[contactId] — update the
 * Business-Workspace-specific fields on a contact (priority, status,
 * segment, assigned agent). Never touches any field the existing
 * Contacts page owns (name/phone/email/company/tags).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ contactId: string }> },
) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'customer_hub')
    const { contactId } = await params

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const ALLOWED_PRIORITY = ['low', 'medium', 'high', 'urgent']
    const ALLOWED_STATUS = ['active', 'inactive', 'vip', 'churned']

    const updates: {
      priority?: string | null
      workspaceStatus?: string | null
      segment?: string | null
      assignedAgentId?: string | null
    } = {}

    if ('priority' in body) {
      if (body.priority !== null && !ALLOWED_PRIORITY.includes(String(body.priority))) {
        return NextResponse.json({ error: 'Invalid priority value' }, { status: 400 })
      }
      updates.priority = body.priority as string | null
    }
    if ('status' in body) {
      if (body.status !== null && !ALLOWED_STATUS.includes(String(body.status))) {
        return NextResponse.json({ error: 'Invalid status value' }, { status: 400 })
      }
      updates.workspaceStatus = body.status as string | null
    }
    if ('segment' in body) updates.segment = body.segment === null ? null : String(body.segment)
    if ('assignedAgentId' in body) updates.assignedAgentId = body.assignedAgentId === null ? null : String(body.assignedAgentId)

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    await updateCustomerWorkspaceFields(supabase, accountId, contactId, updates)
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
