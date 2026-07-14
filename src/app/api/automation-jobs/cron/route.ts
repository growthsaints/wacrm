import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { resumeDelayedFlowRun } from '@/lib/flows/engine'
import { sweepDueSchedules } from '@/lib/flows/schedule'

/**
 * Drain the unified `automation_jobs` queue (Milestone 4, Part 11).
 *
 * Generalizes the automations engine's `automation_pending_executions`
 * cron pattern into one processor for every new engine need: flow
 * `delay` node resumption, scheduled flow starts, and commerce sync
 * jobs. Concurrency-safe via `claim_automation_jobs` (SELECT ... FOR
 * UPDATE SKIP LOCKED), so running this on multiple overlapping cron
 * schedules — or retrying it — never double-processes a job.
 *
 * Retry: a job that throws gets `attempts` incremented and is
 * requeued with exponential backoff (30s * 2^attempts, capped at 1h)
 * until `max_attempts`, then marked `dead` for manual inspection
 * rather than retried forever.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const { data: claimed, error } = await admin.rpc('claim_automation_jobs', {
    p_limit: 25,
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let processed = 0
  let failed = 0
  for (const job of claimed ?? []) {
    try {
      await processJob(job as JobRow)
      await admin.from('automation_jobs').update({ status: 'done' }).eq('id', job.id)
      processed++
    } catch (err) {
      const attempts = (job.attempts as number) + 1
      const message = err instanceof Error ? err.message : String(err)
      const dead = attempts >= (job.max_attempts as number)
      const backoffMs = Math.min(30_000 * 2 ** attempts, 3_600_000)
      await admin
        .from('automation_jobs')
        .update({
          status: dead ? 'dead' : 'pending',
          attempts,
          last_error: message,
          run_at: dead ? (job.run_at as string) : new Date(Date.now() + backoffMs).toISOString(),
        })
        .eq('id', job.id)
      failed++
      console.error('[automation-jobs] job failed:', job.id, message)
    }
  }

  // Sweep due `schedule`-triggered flows into new automation_jobs
  // rows on the same cron beat — no separate schedule shipped for it.
  const scheduled = await sweepDueSchedules(admin)

  return NextResponse.json({ processed, failed, scheduled })
}

interface JobRow {
  id: string
  account_id: string
  job_type: 'flow_resume' | 'flow_scheduled' | 'commerce_sync'
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
  run_at: string
}

async function processJob(job: JobRow): Promise<void> {
  if (job.job_type === 'flow_resume') {
    await resumeDelayedFlowRun({
      flow_run_id: job.payload.flow_run_id as string,
      next_node_key: job.payload.next_node_key as string,
    })
    return
  }
  if (job.job_type === 'flow_scheduled') {
    const { startScheduledFlowRun } = await import('@/lib/flows/schedule')
    await startScheduledFlowRun({
      flowId: job.payload.flow_id as string,
      contactId: job.payload.contact_id as string,
    })
    return
  }
  if (job.job_type === 'commerce_sync') {
    const { runCommerceSyncJob } = await import('@/lib/commerce/sync')
    await runCommerceSyncJob(job.payload as { connectionId: string })
    return
  }
}
