import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * PATCH /api/sms/config/{id}
 *
 * Updates one device's `enabled` (pause/resume — same semantics as the
 * single-device version: new sends and inbound webhook processing both
 * check this) and/or `label`. Scoped to the caller's account via the
 * `.eq('account_id', accountId)` below, so one account can never touch
 * another's device by guessing an id.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params

    const body = await request.json()
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (typeof body.label === 'string' && body.label.trim()) patch.label = body.label.trim()

    if (Object.keys(patch).length === 1) {
      return NextResponse.json({ error: 'Nothing to update — pass enabled and/or label' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('sms_config')
      .update(patch)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, enabled, label')
      .maybeSingle()

    if (error) {
      console.error('[sms/config/[id] PATCH] update error:', error)
      return NextResponse.json({ error: 'Failed to update device' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, ...data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/sms/config/{id}
 *
 * Removes one device. Conversations/messages that were pinned to it
 * keep their history (ON DELETE SET NULL, migration 080) but can no
 * longer send — sendSmsToConversation surfaces that as
 * 'sms_not_configured' rather than silently failing.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params

    const { error } = await supabase.from('sms_config').delete().eq('id', id).eq('account_id', accountId)
    if (error) {
      console.error('[sms/config/[id] DELETE] delete error:', error)
      return NextResponse.json({ error: 'Failed to delete device' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
