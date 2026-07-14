/**
 * `schedule`-triggered flows (Milestone 4, Part 6 + Part 11).
 *
 * Unlike every other trigger, `schedule` has no single triggering
 * event — it fires on a clock instead of an inbound message, tag
 * change, or order webhook. `sweepDueSchedules` runs on the same cron
 * beat as the automation_jobs drain (src/app/api/automation-jobs/cron)
 * and enqueues one `flow_scheduled` job per matching contact, so a
 * schedule with a large audience fans out through the same
 * concurrency-safe queue as everything else rather than looping
 * synchronously inside the cron request.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FlowRow, ScheduleTriggerConfig } from './types'

type DB = SupabaseClient

export async function sweepDueSchedules(db: DB): Promise<number> {
  const { data: flows, error } = await db
    .from('flows')
    .select('*')
    .eq('status', 'active')
    .eq('trigger_type', 'schedule')
  if (error || !flows) return 0

  const now = new Date()
  let enqueued = 0

  for (const flow of flows as FlowRow[]) {
    const cfg = flow.schedule_config as ScheduleTriggerConfig | null
    if (!cfg?.run_at) continue
    const runAt = new Date(cfg.run_at)
    if (Number.isNaN(runAt.getTime())) continue

    const dueOnce = cfg.recurring === 'once' && !cfg.fired_at && runAt <= now
    const dueRecurring =
      cfg.recurring !== 'once' &&
      runAt <= now &&
      (!cfg.fired_at || isDueAgain(new Date(cfg.fired_at), now, cfg.recurring))
    if (!dueOnce && !dueRecurring) continue

    const contactIds = await resolveAudience(db, flow.account_id, cfg.audience)
    for (const contactId of contactIds) {
      // Skip contacts already mid-flow — matches the one-active-run
      // invariant every other trigger already respects. (Re-checked
      // again, per-contact, when the job is actually processed —
      // this is just an early filter to avoid queuing obvious no-ops.)
      const { count } = await db
        .from('flow_runs')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', flow.account_id)
        .eq('contact_id', contactId)
        .eq('status', 'active')
      if ((count ?? 0) > 0) continue

      await db.from('automation_jobs').insert({
        account_id: flow.account_id,
        job_type: 'flow_scheduled',
        payload: { flow_id: flow.id, contact_id: contactId },
        idempotency_key: `flow_scheduled:${flow.id}:${contactId}:${runAt.toISOString()}`,
        run_at: now.toISOString(),
      })
      enqueued++
    }

    await db
      .from('flows')
      .update({ schedule_config: { ...cfg, fired_at: now.toISOString() } })
      .eq('id', flow.id)
  }

  return enqueued
}

function isDueAgain(lastFired: Date, now: Date, recurring: 'daily' | 'weekly'): boolean {
  const intervalMs = recurring === 'daily' ? 86_400_000 : 7 * 86_400_000
  return now.getTime() - lastFired.getTime() >= intervalMs
}

async function resolveAudience(
  db: DB,
  accountId: string,
  audience: ScheduleTriggerConfig['audience'],
): Promise<string[]> {
  if (audience === 'all_contacts') {
    const { data } = await db.from('contacts').select('id').eq('account_id', accountId)
    return (data ?? []).map((r) => (r as { id: string }).id)
  }
  const { data } = await db
    .from('contact_tags')
    .select('contact_id, contacts!inner(account_id)')
    .eq('tag_id', audience.tag_id)
    .eq('contacts.account_id', accountId)
  return (data ?? []).map((r) => (r as { contact_id: string }).contact_id)
}

/** Called by the automation_jobs processor for a due `flow_scheduled` job. */
export async function startScheduledFlowRun(input: {
  flowId: string
  contactId: string
}): Promise<void> {
  const { startFlowRunForContact } = await import('./engine')
  await startFlowRunForContact(input.flowId, input.contactId)
}
