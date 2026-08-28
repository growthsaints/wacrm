// ============================================================
// GET /api/meta-ads/pages — Facebook Pages the connected ad account's
// token can act as. A Click-to-WhatsApp ad's destination is tied to a
// Page (whichever WhatsApp number is linked to it in Business
// Manager), not a phone number field on the ad itself — this backs
// the Page picker in the campaign wizard.
// ============================================================

import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/meta-ads/encryption'
import { listPages } from '@/lib/meta-ads/client'

export async function GET() {
  try {
    const { supabase } = await getCurrentAccount()

    const { data: config, error: configError } = await supabase
      .from('meta_ads_config')
      .select('access_token')
      .maybeSingle()
    if (configError || !config) {
      return NextResponse.json({ error: 'Connect an ad account first (Settings → Meta Ads)' }, { status: 400 })
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      return NextResponse.json({ error: 'Stored access token could not be decrypted — reconnect the ad account' }, { status: 500 })
    }

    try {
      const pages = await listPages(accessToken)
      return NextResponse.json({ pages })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not list Pages from Meta'
      return NextResponse.json({ error: message }, { status: 502 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
