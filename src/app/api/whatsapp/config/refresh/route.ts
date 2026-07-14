// ============================================================
// POST /api/whatsapp/config/refresh
//
// "Refresh status" — re-fetches live phone + business metadata from
// Meta and updates the cached columns (migration 038) used by the
// WhatsApp Management UI. Works for both onboarding methods: it only
// needs the phone_number_id + stored access token already on the row,
// so a legacy manually-connected number benefits from it exactly the
// same as an Embedded-Signup-connected one.
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getBusinessDetails, getWabaDetails, verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const limit = checkRateLimit(`whatsapp:refresh:${user.id}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError || !config) {
      return NextResponse.json({ error: 'No WhatsApp configuration to refresh.' }, { status: 400 })
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      return NextResponse.json(
        { error: "Stored access token can't be decrypted. Reconnect WhatsApp." },
        { status: 400 },
      )
    }

    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({ phoneNumberId: config.phone_number_id, accessToken })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      return NextResponse.json({ error: `Meta API error: ${message}` }, { status: 502 })
    }

    let businessName: string | null = config.business_name ?? null
    try {
      if (config.business_id) {
        const biz = await getBusinessDetails({ businessId: config.business_id, accessToken })
        businessName = biz.name ?? businessName
      } else if (config.waba_id) {
        const waba = await getWabaDetails({ wabaId: config.waba_id, accessToken })
        businessName = waba.name ?? businessName
      }
    } catch (err) {
      console.warn(
        '[whatsapp refresh] business/WABA name lookup failed (non-fatal):',
        err instanceof Error ? err.message : err,
      )
    }

    const nowIso = new Date().toISOString()
    const { data: updated, error: updateError } = await supabase
      .from('whatsapp_config')
      .update({
        display_phone_number: phoneInfo.display_phone_number ?? null,
        display_name: phoneInfo.verified_name ?? null,
        quality_rating: phoneInfo.quality_rating ?? null,
        messaging_limit_tier: phoneInfo.messaging_limit_tier ?? null,
        code_verification_status: phoneInfo.code_verification_status ?? null,
        business_name: businessName,
        last_synced_at: nowIso,
        updated_at: nowIso,
      })
      .eq('account_id', accountId)
      .select('*')
      .maybeSingle()

    if (updateError) {
      console.error('[whatsapp refresh] update failed:', updateError)
      return NextResponse.json({ error: 'Failed to save refreshed status.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, config: updated })
  } catch (error) {
    console.error('[whatsapp refresh] unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
