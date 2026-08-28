// ============================================================
// GET    /api/meta-ads/config — this account's connected ad account
//        (viewer+ can see it's connected; access_token is never
//        returned).
// POST   /api/meta-ads/config — connect (or reconnect) an ad account.
//        admin+. Verifies the token can actually read the ad account
//        before storing anything (same "don't trust what was typed"
//        pattern as httpSMS's config route).
// DELETE /api/meta-ads/config — disconnect. admin+.
//
// BYO System User access token (see migration 086's header comment
// for why this isn't an OAuth "Connect" button yet — Advanced Access
// for third-party ad accounts requires an App Review this app
// doesn't have).
// ============================================================

import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/meta-ads/encryption'
import { verifyAdAccount } from '@/lib/meta-ads/client'

const CONFIG_COLUMNS = 'id, ad_account_id, business_id, connected_name, currency, enabled, created_at'

export async function GET() {
  try {
    const { supabase } = await getCurrentAccount()
    const { data, error } = await supabase.from('meta_ads_config').select(CONFIG_COLUMNS).maybeSingle()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ config: data ?? null })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    }

    const adAccountId = typeof body.ad_account_id === 'string' ? body.ad_account_id.trim() : ''
    const accessToken = typeof body.access_token === 'string' ? body.access_token.trim() : ''
    if (!adAccountId || !accessToken) {
      return NextResponse.json({ error: "'ad_account_id' and 'access_token' are required" }, { status: 400 })
    }

    let accountInfo
    try {
      accountInfo = await verifyAdAccount({ accessToken, adAccountId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Meta rejected this token/ad account combination'
      return NextResponse.json({ error: `Could not verify with Meta: ${message}` }, { status: 400 })
    }

    const { data, error } = await ctx.supabase
      .from('meta_ads_config')
      .upsert(
        {
          account_id: ctx.accountId,
          ad_account_id: accountInfo.id,
          connected_name: accountInfo.name,
          currency: accountInfo.currency,
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

    return NextResponse.json({ config: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole('admin')
    const { error } = await ctx.supabase.from('meta_ads_config').delete().eq('account_id', ctx.accountId)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
