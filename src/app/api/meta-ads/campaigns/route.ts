// ============================================================
// GET  /api/meta-ads/campaigns — list this account's launched
//      campaigns.
// POST /api/meta-ads/campaigns — create + launch one, PAUSED, on
//      Meta. admin+. The actual Meta API calls run in after() — see
//      lib/meta-ads/launch.ts — so this responds fast and the row
//      transitions draft → launching → paused/failed as that
//      background work completes; the client polls GET to see it.
// ============================================================

import { NextResponse, after } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { launchCampaign } from '@/lib/meta-ads/launch'

const CAMPAIGN_COLUMNS =
  'id, name, page_id, page_name, daily_budget, currency, primary_text, image_url, custom_audience_id, meta_campaign_id, meta_adset_id, meta_ad_id, status, error_message, created_at, updated_at'

export async function GET() {
  try {
    const { supabase } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('meta_ad_campaigns')
      .select(CAMPAIGN_COLUMNS)
      .order('created_at', { ascending: false })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ campaigns: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const { data: config, error: configError } = await ctx.supabase
      .from('meta_ads_config')
      .select('id, currency')
      .maybeSingle()
    if (configError || !config) {
      return NextResponse.json({ error: 'Connect an ad account first (Settings → Meta Ads)' }, { status: 400 })
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const pageId = typeof body.page_id === 'string' ? body.page_id.trim() : ''
    const pageName = typeof body.page_name === 'string' ? body.page_name.trim() : null
    const primaryText = typeof body.primary_text === 'string' ? body.primary_text.trim() : ''
    const imageUrl = typeof body.image_url === 'string' && body.image_url.trim() ? body.image_url.trim() : null
    const customAudienceId =
      typeof body.custom_audience_id === 'string' && body.custom_audience_id.trim()
        ? body.custom_audience_id.trim()
        : null
    const dailyBudget = typeof body.daily_budget === 'number' ? body.daily_budget : Number(body.daily_budget)

    if (!name) return NextResponse.json({ error: "'name' is required" }, { status: 400 })
    if (!pageId) return NextResponse.json({ error: "'page_id' is required" }, { status: 400 })
    if (!primaryText) return NextResponse.json({ error: "'primary_text' is required" }, { status: 400 })
    if (!imageUrl) {
      return NextResponse.json({ error: 'An image is required — Meta rejects this ad format without one' }, { status: 400 })
    }
    if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) {
      return NextResponse.json({ error: "'daily_budget' must be a positive number" }, { status: 400 })
    }

    if (customAudienceId) {
      const { data: audience } = await ctx.supabase
        .from('meta_custom_audiences')
        .select('id, status')
        .eq('id', customAudienceId)
        .maybeSingle()
      if (!audience) {
        return NextResponse.json({ error: 'Audience not found' }, { status: 400 })
      }
      if (audience.status !== 'ready') {
        return NextResponse.json({ error: 'The selected audience has not finished syncing to Meta yet' }, { status: 400 })
      }
    }

    const { data: created, error } = await ctx.supabase
      .from('meta_ad_campaigns')
      .insert({
        account_id: ctx.accountId,
        meta_ads_config_id: config.id,
        custom_audience_id: customAudienceId,
        name,
        page_id: pageId,
        page_name: pageName,
        daily_budget: dailyBudget,
        currency: config.currency ?? 'INR',
        primary_text: primaryText,
        image_url: imageUrl,
        status: 'launching',
        created_by: ctx.userId,
      })
      .select(CAMPAIGN_COLUMNS)
      .single()

    if (error || !created) {
      return NextResponse.json({ error: error?.message ?? 'Failed to create campaign' }, { status: 500 })
    }

    after(async () => {
      await launchCampaign(supabaseAdmin(), created.id)
    })

    return NextResponse.json({ campaign: created }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
