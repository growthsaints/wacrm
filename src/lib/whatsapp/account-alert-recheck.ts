import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'

/**
 * Real-time (and cron-backed) auto-clear for whatsapp_account_events'
 * flagged rows — the source of the WhatsAppAccountAlertBanner. That
 * banner previously only cleared once a platform admin manually
 * marked the row resolved (POST /api/platform/organizations/[id]),
 * because the webhook handler's own keyword-flagging comments already
 * explain Meta's exact "banned/restricted" payload shape isn't
 * something this codebase parses with confidence — so rather than
 * guess a "cleared" shape too, this asks Meta directly: does a basic
 * phone-number read still succeed? A restricted/disabled/under-review
 * number's own Graph API calls typically fail outright (OAuthException
 * or a permission error) — a clean response is real evidence the
 * number is healthy again. Failure here proves nothing new, so it
 * never flags anything — it only ever leaves existing flags in place
 * for a human to look at.
 *
 * Called two ways: in real time from the webhook handler right after
 * any account-level event is logged (api/whatsapp/webhook/route.ts),
 * and from a periodic cron (api/whatsapp/account-alerts/recheck) that
 * catches an account whose restriction lifted with no further webhook
 * from Meta at all.
 */
export async function recheckAccountAlert(
  db: SupabaseClient,
  accountId: string,
): Promise<boolean> {
  try {
    // Cheap short-circuit — skip the Graph API call entirely when
    // there's nothing flagged to clear for this account.
    const { data: unresolved } = await db
      .from('whatsapp_account_events')
      .select('id')
      .eq('account_id', accountId)
      .eq('flagged', true)
      .eq('resolved', false)
      .limit(1)
    if (!unresolved || unresolved.length === 0) return false

    const { data: config } = await db
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', accountId)
      .maybeSingle()
    const row = config as
      | { phone_number_id?: string | null; access_token?: string | null }
      | null
    if (!row?.phone_number_id || !row.access_token) return false

    let accessToken: string
    try {
      accessToken = decrypt(row.access_token)
    } catch {
      return false
    }

    // Throws on a restricted/disabled/under-review number — see
    // module comment. Only a successful response reaches the update
    // below.
    await verifyPhoneNumber({ phoneNumberId: row.phone_number_id, accessToken })

    const { error } = await db
      .from('whatsapp_account_events')
      .update({ resolved: true })
      .eq('account_id', accountId)
      .eq('flagged', true)
      .eq('resolved', false)

    if (error) {
      console.error('[account-alert-recheck] failed to auto-resolve:', error.message)
      return false
    }
    // `unresolved` above already confirmed at least one row existed.
    return true
  } catch (err) {
    // Meta call failed (or something upstream did) — the number is
    // most likely still restricted. Leave every flagged row as-is.
    console.error(
      '[account-alert-recheck] verify failed, leaving flagged:',
      err instanceof Error ? err.message : err,
    )
    return false
  }
}
