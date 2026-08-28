import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { recheckAccountAlert } from '@/lib/whatsapp/account-alert-recheck'

/**
 * Periodic safety net for the WhatsAppAccountAlertBanner: re-verifies
 * every account with an unresolved flagged whatsapp_account_events row
 * against the live Graph API and auto-clears it once the number is
 * healthy again (see account-alert-recheck.ts for why a clean Graph
 * API response is trusted as "resolved" evidence).
 *
 * The webhook handler already does this in real time whenever Meta
 * sends a new account-level event for that account
 * (api/whatsapp/webhook/route.ts) — this cron exists for the case
 * where a restriction lifts with no further webhook from Meta at all
 * (e.g. the customer fixed it directly in Meta Business Suite).
 *
 * Auth: re-uses `AUTOMATION_CRON_SECRET` so operators only have one
 * secret to provision, same convention as flows/cron.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }

  // Constant-time comparison — same rationale as flows/cron: an
  // attacker probing this endpoint can't recover the secret
  // byte-by-byte from response-time deltas.
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
  const { data: rows, error } = await admin
    .from('whatsapp_account_events')
    .select('account_id')
    .eq('flagged', true)
    .eq('resolved', false)
    .not('account_id', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const accountIds = [...new Set((rows ?? []).map((r) => r.account_id as string))]

  let resolved = 0
  for (const accountId of accountIds) {
    const didResolve = await recheckAccountAlert(admin, accountId)
    if (didResolve) resolved++
  }

  return NextResponse.json({ checked: accountIds.length, resolved })
}
