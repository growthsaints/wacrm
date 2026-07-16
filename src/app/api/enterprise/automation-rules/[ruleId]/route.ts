import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireEnterpriseFeature } from '@/lib/enterprise/guard'

/** PATCH /api/enterprise/automation-rules/[ruleId] — toggle enabled. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ ruleId: string }> },
) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireEnterpriseFeature(supabase, accountId, role, 'automation_rules')
    const { ruleId } = await params

    const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null
    if (typeof body?.enabled !== 'boolean') {
      return NextResponse.json({ error: "'enabled' (boolean) is required" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('enterprise_automation_rules')
      .update({ enabled: body.enabled })
      .eq('id', ruleId)
      .eq('account_id', accountId)
      .select('*')
      .single()
    if (error) {
      console.error('[PATCH /api/enterprise/automation-rules/:id] update error:', error)
      return NextResponse.json({ error: 'Failed to update rule' }, { status: 500 })
    }
    return NextResponse.json({ rule: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/enterprise/automation-rules/[ruleId] */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ ruleId: string }> },
) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireEnterpriseFeature(supabase, accountId, role, 'automation_rules')
    const { ruleId } = await params

    const { error } = await supabase
      .from('enterprise_automation_rules')
      .delete()
      .eq('id', ruleId)
      .eq('account_id', accountId)
    if (error) {
      console.error('[DELETE /api/enterprise/automation-rules/:id] delete error:', error)
      return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
