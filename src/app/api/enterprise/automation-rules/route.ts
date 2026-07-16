import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireEnterpriseFeature } from '@/lib/enterprise/guard'

const CONDITION_TYPES = ['quality_rating_drops', 'failure_rate_above', 'messaging_tier_downgraded', 'disconnected']

/** GET /api/enterprise/automation-rules — list this account's rules. */
export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireEnterpriseFeature(supabase, accountId, role, 'automation_rules')

    const { data, error } = await supabase
      .from('enterprise_automation_rules')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
    if (error) {
      console.error('[GET /api/enterprise/automation-rules] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load rules' }, { status: 500 })
    }
    return NextResponse.json({ rules: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST /api/enterprise/automation-rules — create a rule. */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, role, userId } = await getCurrentAccount()
    await requireEnterpriseFeature(supabase, accountId, role, 'automation_rules')

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; conditionType?: unknown; conditionValue?: unknown }
      | null
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const conditionType = typeof body?.conditionType === 'string' ? body.conditionType : ''
    const conditionValue = typeof body?.conditionValue === 'number' ? body.conditionValue : null

    if (!name || !CONDITION_TYPES.includes(conditionType)) {
      return NextResponse.json({ error: 'name and a valid conditionType are required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('enterprise_automation_rules')
      .insert({
        account_id: accountId,
        name,
        condition_type: conditionType,
        condition_value: conditionValue,
        created_by: userId,
      })
      .select('*')
      .single()
    if (error) {
      console.error('[POST /api/enterprise/automation-rules] insert error:', error)
      return NextResponse.json({ error: 'Failed to create rule' }, { status: 500 })
    }
    return NextResponse.json({ rule: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
