import { NextResponse } from 'next/server'
import { platformAdminClient } from '@/lib/platform/admin-client'
import { getAccountOverview, getRiskCenter } from '@/lib/enterprise/queries'

/**
 * Evaluates every enabled enterprise_automation_rules row against its
 * account's current signals and stamps last_triggered_at when the
 * condition holds. Meant to be hit on a schedule (external cron/VPS
 * crontab) — requires `x-cron-secret` to match ENTERPRISE_CRON_SECRET,
 * mirroring /api/automations/cron's pattern.
 *
 * There is no broadcast pause/resume capability to hook a stronger
 * action into today, so "triggered" is the whole effect — visible on
 * the rule's own row (see the Automation Rules page).
 */
export async function GET(request: Request) {
  const expected = process.env.ENTERPRISE_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = platformAdminClient()

  const { data: rules, error } = await admin
    .from('enterprise_automation_rules')
    .select('id, account_id, condition_type, condition_value')
    .eq('enabled', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!rules || rules.length === 0) return NextResponse.json({ checked: 0, triggered: 0 })

  let triggered = 0
  for (const rule of rules as Array<{
    id: string
    account_id: string
    condition_type: string
    condition_value: number | null
  }>) {
    let shouldTrigger = false
    try {
      if (rule.condition_type === 'disconnected' || rule.condition_type === 'messaging_tier_downgraded') {
        const overview = await getAccountOverview(admin, rule.account_id)
        if (rule.condition_type === 'disconnected') {
          shouldTrigger = !overview.whatsapp.connected
        } else {
          shouldTrigger = overview.whatsapp.messagingLimitTier === 'TIER_250' || !overview.whatsapp.messagingLimitTier
        }
      } else if (rule.condition_type === 'quality_rating_drops') {
        const risk = await getRiskCenter(admin, rule.account_id)
        shouldTrigger = risk.qualityRisk !== 'low'
      } else if (rule.condition_type === 'failure_rate_above') {
        const risk = await getRiskCenter(admin, rule.account_id)
        const overview = await getAccountOverview(admin, rule.account_id)
        const threshold = rule.condition_value ?? 10
        shouldTrigger = overview.broadcastPerformance.failureRate > threshold && risk.failedContacts > 0
      }
    } catch (err) {
      console.error(`[enterprise-automation-cron] rule ${rule.id} evaluation failed:`, err)
      continue
    }

    if (shouldTrigger) {
      await admin
        .from('enterprise_automation_rules')
        .update({ last_triggered_at: new Date().toISOString() })
        .eq('id', rule.id)
      triggered++
    }
  }

  return NextResponse.json({ checked: rules.length, triggered })
}
