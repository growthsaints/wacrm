// ============================================================
// POST /api/meta-ads/oauth/complete — turns a finished "Connect with
// Facebook" popup (see components/meta-ads/connect-meta-ads-button.tsx)
// into a connected Meta Ads account, without the admin ever generating
// or pasting a System User access token by hand.
//
//   1. Exchange the short-lived authorization code for a long-lived
//      user access token — reuses the exact OAuth exchange the
//      WhatsApp Embedded Signup flow already does (same client_id/
//      client_secret/code → token → long-lived-token dance; this part
//      of Facebook Login isn't WhatsApp-specific).
//   2. List the ad accounts this token administers.
//   3. Pick one automatically — the first ACTIVE one if any, otherwise
//      the first one at all — rather than building a whole separate
//      "choose an account" step for what's a rare case (most admins
//      only manage one ad account). An admin who needs a *different*
//      one can still use the manual BYO-token field to override it.
//   4. Store it exactly like the manual /api/meta-ads/config POST does
//      (verified name/currency, encrypted token).
//
// This is the self-serve counterpart to the manual BYO System User
// token flow (still kept — see migration 086's header comment and
// config/route.ts) — both exist side by side, same pattern as
// WhatsApp's Embedded Signup + "Advanced setup" manual path.
//
// Requesting `ads_management`/`ads_read`/`business_management`/
// `pages_show_list` in production for accounts outside this Meta App's
// own admins/testers requires Meta's App Review (Advanced Access) —
// until that's approved, this works for the app's own team only.
// ============================================================

import { NextResponse } from 'next/server'

import { requireMetaAdsAccess, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/meta-ads/encryption'
import { AD_ACCOUNT_ACTIVE_STATUS, listAdAccounts } from '@/lib/meta-ads/client'
import { exchangeEmbeddedSignupCode } from '@/lib/whatsapp/meta-api'

const CONFIG_COLUMNS = 'id, ad_account_id, business_id, connected_name, currency, enabled, created_at'

export async function POST(request: Request) {
  try {
    const ctx = await requireMetaAdsAccess()

    const body = (await request.json().catch(() => null)) as { code?: unknown } | null
    const code = typeof body?.code === 'string' ? body.code : ''
    if (!code) {
      return NextResponse.json({ error: "'code' is required" }, { status: 400 })
    }

    const appId = process.env.META_APP_ID
    const appSecret = process.env.META_APP_SECRET
    if (!appId || !appSecret) {
      console.error('[meta-ads/oauth] META_APP_ID / META_APP_SECRET not configured')
      return NextResponse.json({ error: 'Connecting with Facebook is not configured on this server.' }, { status: 500 })
    }

    let accessToken: string
    try {
      const exchanged = await exchangeEmbeddedSignupCode({ appId, appSecret, code })
      accessToken = exchanged.accessToken
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Meta token exchange failed'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    let adAccounts
    try {
      adAccounts = await listAdAccounts(accessToken)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not list ad accounts from Meta'
      return NextResponse.json({ error: message }, { status: 502 })
    }
    if (adAccounts.length === 0) {
      return NextResponse.json(
        { error: "Facebook didn't return any ad accounts you administer — ask a Business Manager admin to add you to one first." },
        { status: 400 },
      )
    }

    const picked = adAccounts.find((a) => a.account_status === AD_ACCOUNT_ACTIVE_STATUS) ?? adAccounts[0]

    const { data, error } = await ctx.supabase
      .from('meta_ads_config')
      .upsert(
        {
          account_id: ctx.accountId,
          ad_account_id: picked.id,
          connected_name: picked.name,
          currency: picked.currency,
          access_token: encrypt(accessToken),
          enabled: true,
          created_by: ctx.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id' },
      )
      .select(CONFIG_COLUMNS)
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ config: data, totalAdAccounts: adAccounts.length })
  } catch (err) {
    return toErrorResponse(err)
  }
}
