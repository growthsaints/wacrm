import { NextResponse } from 'next/server'
import { platformAdminClient } from '@/lib/platform/admin-client'
import { getAccountHealth } from '@/lib/enterprise/queries'

/**
 * Snapshots today's Health Score for every tenant with an active
 * account_health license, so the Account Health page can show a real
 * trend instead of only ever a single current-moment number. Meant to
 * be hit once a day (external cron/VPS crontab) — requires
 * `x-cron-secret` to match ENTERPRISE_CRON_SECRET, reusing the same
 * secret /api/enterprise/automation-rules/cron already uses (no new
 * env var to configure).
 *
 * Upserts on (account_id, snapshot_date) so re-running it the same
 * day (a retry, a manual trigger) just overwrites today's row with
 * the latest score rather than creating duplicates.
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

  const { data: licenses, error } = await admin
    .from('enterprise_licenses')
    .select('account_id, expiry_date')
    .eq('enterprise_enabled', true)
    .eq('account_health', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const now = Date.now()
  const activeAccountIds = (licenses ?? [])
    .filter((l) => !l.expiry_date || new Date(l.expiry_date).getTime() > now)
    .map((l) => l.account_id as string)

  const today = new Date().toISOString().slice(0, 10)
  let snapshotted = 0

  for (const accountId of activeAccountIds) {
    try {
      const health = await getAccountHealth(admin, accountId)
      const { error: upsertErr } = await admin.from('enterprise_account_health_history').upsert(
        {
          account_id: accountId,
          snapshot_date: today,
          score: health.score,
          quality_rating: health.qualityRating,
          failure_rate: health.failureRate,
          reply_rate: health.replyRate,
        },
        { onConflict: 'account_id,snapshot_date' },
      )
      if (upsertErr) {
        console.error(`[account-health-cron] upsert failed for ${accountId}:`, upsertErr.message)
        continue
      }
      snapshotted++
    } catch (err) {
      console.error(`[account-health-cron] snapshot failed for ${accountId}:`, err)
    }
  }

  return NextResponse.json({ checked: activeAccountIds.length, snapshotted })
}
