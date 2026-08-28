// ============================================================
// POST /api/meta-ads/campaigns/{id}/status — Activate or pause a
// launched campaign directly from wacrm, so an admin never has to
// leave the CRM and go into Ads Manager just to turn delivery on/off.
// admin+. Runs synchronously (a couple of quick Graph API calls, not
// a multi-step launch) and updates wacrm's own status column to
// match on success.
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/meta-ads/encryption'
import { setCampaignDeliveryStatus } from '@/lib/meta-ads/client'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params

    const body = (await request.json().catch(() => null)) as { status?: string } | null
    const status = body?.status
    if (status !== 'active' && status !== 'paused') {
      return NextResponse.json({ error: "'status' must be 'active' or 'paused'" }, { status: 400 })
    }

    const { data: row, error: rowError } = await ctx.supabase
      .from('meta_ad_campaigns')
      .select('id, meta_ads_config_id, meta_campaign_id, meta_adset_id, meta_ad_id, status')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (rowError || !row) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }
    if (!row.meta_campaign_id || !row.meta_adset_id || !row.meta_ad_id) {
      return NextResponse.json({ error: 'This campaign has not finished launching on Meta yet' }, { status: 400 })
    }
    if (row.status !== 'paused' && row.status !== 'active') {
      return NextResponse.json({ error: `Can't change status while the campaign is '${row.status}'` }, { status: 400 })
    }

    const { data: config, error: configError } = await ctx.supabase
      .from('meta_ads_config')
      .select('access_token')
      .eq('id', row.meta_ads_config_id)
      .maybeSingle()
    if (configError || !config) {
      return NextResponse.json({ error: 'Ad account is no longer connected' }, { status: 400 })
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      return NextResponse.json({ error: 'Stored access token could not be decrypted — reconnect the ad account' }, { status: 500 })
    }

    try {
      await setCampaignDeliveryStatus({
        accessToken,
        campaignId: row.meta_campaign_id,
        adSetId: row.meta_adset_id,
        adId: row.meta_ad_id,
        status: status === 'active' ? 'ACTIVE' : 'PAUSED',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update the campaign status on Meta'
      return NextResponse.json({ error: message }, { status: 502 })
    }

    const { error: updateError } = await ctx.supabase
      .from('meta_ad_campaigns')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ status })
  } catch (err) {
    return toErrorResponse(err)
  }
}
