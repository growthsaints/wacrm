// ============================================================
// GET /api/meta-ads/campaigns/{id}/insights — lifetime spend/reach/
// impressions/clicks for a launched campaign, plus Meta's ad review
// outcome (effective_status/ad_review_feedback) — read from Meta on
// demand (not cached/stored — always live). Meta's own review runs
// asynchronously after wacrm's launch steps succeed, so this is the
// only way an admin finds out an ad was disapproved or flagged;
// there's no webhook wired up for it.
// ============================================================

import { NextResponse } from 'next/server'

import { requireMetaAdsAccess, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/meta-ads/encryption'
import { getAdReviewStatus, getCampaignInsights } from '@/lib/meta-ads/client'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireMetaAdsAccess()
    const { id } = await params

    const { data: row, error: rowError } = await supabase
      .from('meta_ad_campaigns')
      .select('meta_ads_config_id, meta_campaign_id, meta_ad_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (rowError || !row) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }
    if (!row.meta_campaign_id) {
      return NextResponse.json({ error: 'This campaign has not finished launching on Meta yet' }, { status: 400 })
    }

    const { data: config, error: configError } = await supabase
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
      const insights = await getCampaignInsights({ accessToken, campaignId: row.meta_campaign_id })
      // Review status is per-ad, not per-campaign — only fetched if the
      // ad step actually finished. Failure here doesn't fail the whole
      // request; insights are still useful without it.
      let reviewStatus = null
      if (row.meta_ad_id) {
        try {
          reviewStatus = await getAdReviewStatus({ accessToken, adId: row.meta_ad_id })
        } catch (err) {
          console.error('[meta-ads/insights] review status fetch failed:', err instanceof Error ? err.message : err)
        }
      }
      return NextResponse.json({ insights, reviewStatus })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load insights from Meta'
      return NextResponse.json({ error: message }, { status: 502 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
