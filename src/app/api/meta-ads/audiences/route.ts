// ============================================================
// GET  /api/meta-ads/audiences — list this account's Custom Audiences
// POST /api/meta-ads/audiences — create one from a CRM segment
//      (all/tags/custom_field, same shape as a broadcast's
//      audience_filter minus 'csv' — a Custom Audience is a saved,
//      re-syncable segment, not a one-off pasted list). admin+.
//
// The actual resolve → hash → upload-to-Meta work happens in
// after() — see lib/meta-ads/sync.ts — so a large CRM segment doesn't
// block this response. The row is created 'pending' and flips to
// 'creating' then 'ready'/'failed' as that background work runs;
// the client polls GET to see the transition.
// ============================================================

import { NextResponse, after } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { syncCustomAudience } from '@/lib/meta-ads/sync'
import type { AudienceFilter } from '@/lib/meta-ads/audience'

const AUDIENCE_COLUMNS =
  'id, name, audience_filter, contact_count, status, error_message, meta_audience_id, created_at, updated_at'

function isValidAudienceFilter(value: unknown): value is AudienceFilter {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.type === 'all') return true
  if (v.type === 'tags') return Array.isArray(v.tagIds) && v.tagIds.every((t) => typeof t === 'string')
  if (v.type === 'custom_field') {
    const cf = v.customField as Record<string, unknown> | undefined
    return (
      !!cf &&
      typeof cf.fieldId === 'string' &&
      ['is', 'is_not', 'contains'].includes(cf.operator as string) &&
      typeof cf.value === 'string'
    )
  }
  return false
}

export async function GET() {
  try {
    const { supabase } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('meta_custom_audiences')
      .select(AUDIENCE_COLUMNS)
      .order('created_at', { ascending: false })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ audiences: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const { data: config, error: configError } = await ctx.supabase
      .from('meta_ads_config')
      .select('id')
      .maybeSingle()
    if (configError || !config) {
      return NextResponse.json({ error: 'Connect an ad account first (Settings → Meta Ads)' }, { status: 400 })
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return NextResponse.json({ error: "'name' is required" }, { status: 400 })
    }
    if (!isValidAudienceFilter(body.audience_filter)) {
      return NextResponse.json(
        { error: "'audience_filter' must be {type:'all'} | {type:'tags', tagIds:[...]} | {type:'custom_field', customField:{...}}" },
        { status: 400 },
      )
    }

    const { data: created, error } = await ctx.supabase
      .from('meta_custom_audiences')
      .insert({
        account_id: ctx.accountId,
        meta_ads_config_id: config.id,
        name,
        audience_filter: body.audience_filter,
        status: 'creating',
        created_by: ctx.userId,
      })
      .select(AUDIENCE_COLUMNS)
      .single()

    if (error || !created) {
      return NextResponse.json({ error: error?.message ?? 'Failed to create audience' }, { status: 500 })
    }

    after(async () => {
      await syncCustomAudience(supabaseAdmin(), created.id)
    })

    return NextResponse.json({ audience: created }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
