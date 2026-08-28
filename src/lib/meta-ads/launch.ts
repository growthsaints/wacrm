// ============================================================
// Launches one meta_ad_campaigns row as a real Campaign → Ad Set →
// Ad Creative → Ad on Meta — always PAUSED (see client.ts's header
// comment for why). Runs inside the API route's after() callback,
// same pattern as lib/meta-ads/sync.ts, and never throws: every
// failure path marks the row 'failed' with a human-readable reason
// since there's no caller left to receive an exception once this
// runs in the background.
//
// Meta object ids are persisted as each step succeeds (not only at
// the very end) — if a later step fails, the row still records
// exactly how far it got, useful for cleaning up in Ads Manager
// rather than leaving an untraceable half-built campaign.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/meta-ads/encryption'
import {
  createAd,
  createAdCreative,
  createAdSet,
  createCampaign,
  uploadAdImageFromUrl,
} from '@/lib/meta-ads/client'

async function markFailed(db: SupabaseClient, campaignRowId: string, message: string): Promise<void> {
  const { error } = await db
    .from('meta_ad_campaigns')
    .update({ status: 'failed', error_message: message, updated_at: new Date().toISOString() })
    .eq('id', campaignRowId)
  if (error) {
    console.error('[meta-ads/launch] failed to mark campaign failed:', error.message)
  }
}

export async function launchCampaign(db: SupabaseClient, campaignRowId: string): Promise<void> {
  try {
    const { data: row, error: rowError } = await db
      .from('meta_ad_campaigns')
      .select(
        'id, meta_ads_config_id, custom_audience_id, name, page_id, daily_budget, primary_text, image_url',
      )
      .eq('id', campaignRowId)
      .maybeSingle()
    if (rowError || !row) return

    const { data: config, error: configError } = await db
      .from('meta_ads_config')
      .select('ad_account_id, access_token, enabled')
      .eq('id', row.meta_ads_config_id)
      .maybeSingle()
    if (configError || !config) {
      await markFailed(db, campaignRowId, 'Ad account is no longer connected')
      return
    }
    if (!config.enabled) {
      await markFailed(db, campaignRowId, 'Ad account connection is disabled')
      return
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      await markFailed(db, campaignRowId, 'Stored access token could not be decrypted — reconnect the ad account')
      return
    }

    let metaAudienceId: string | null = null
    if (row.custom_audience_id) {
      const { data: audience } = await db
        .from('meta_custom_audiences')
        .select('meta_audience_id, status')
        .eq('id', row.custom_audience_id)
        .maybeSingle()
      if (!audience?.meta_audience_id || audience.status !== 'ready') {
        await markFailed(db, campaignRowId, 'The selected audience has not finished syncing to Meta yet')
        return
      }
      metaAudienceId = audience.meta_audience_id
    }

    let imageHash: string | undefined
    if (row.image_url) {
      const uploaded = await uploadAdImageFromUrl({
        accessToken,
        adAccountId: config.ad_account_id,
        imageUrl: row.image_url,
      })
      imageHash = uploaded.hash
    }

    const campaign = await createCampaign({ accessToken, adAccountId: config.ad_account_id, name: row.name })
    await db.from('meta_ad_campaigns').update({ meta_campaign_id: campaign.id }).eq('id', campaignRowId)

    const adSet = await createAdSet({
      accessToken,
      adAccountId: config.ad_account_id,
      campaignId: campaign.id,
      name: `${row.name} — ad set`,
      pageId: row.page_id,
      dailyBudgetMajorUnits: Number(row.daily_budget),
      customAudienceId: metaAudienceId ?? undefined,
    })
    await db.from('meta_ad_campaigns').update({ meta_adset_id: adSet.id }).eq('id', campaignRowId)

    const creative = await createAdCreative({
      accessToken,
      adAccountId: config.ad_account_id,
      name: `${row.name} — creative`,
      pageId: row.page_id,
      message: row.primary_text,
      imageHash,
    })
    await db.from('meta_ad_campaigns').update({ meta_creative_id: creative.id }).eq('id', campaignRowId)

    const ad = await createAd({
      accessToken,
      adAccountId: config.ad_account_id,
      adsetId: adSet.id,
      creativeId: creative.id,
      name: `${row.name} — ad`,
    })

    const { error: doneError } = await db
      .from('meta_ad_campaigns')
      .update({
        meta_ad_id: ad.id,
        status: 'paused',
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignRowId)
    if (doneError) {
      console.error('[meta-ads/launch] failed to mark campaign paused:', doneError.message)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error launching the campaign on Meta'
    console.error('[meta-ads/launch] launch failed:', message)
    await markFailed(db, campaignRowId, message)
  }
}
