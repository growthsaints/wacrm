// ============================================================
// POST /api/whatsapp/embedded-signup/complete
//
// The single endpoint that turns a finished Facebook Embedded Signup
// popup into a fully working WhatsApp connection. The client
// (connect-whatsapp-button.tsx) hands us the short-lived authorization
// `code` from FB.login() plus the `wabaId` / `phoneNumberId` (and
// optional `businessId`) Meta posted via the WA_EMBEDDED_SIGNUP
// window message. From here everything is automatic:
//
//   1. Exchange the code for a long-lived access token
//   2. Fetch + verify phone metadata
//   3. Register the number for inbound webhooks (auto-generated PIN)
//   4. Subscribe the WABA to our app's webhook
//   5. Resolve a human-readable business name
//   6. Persist the config (through the RLS-scoped client, so the
//      existing admin-only whatsapp_config_insert/update policies
//      from migration 017 are the same gate the manual flow uses —
//      no separate role check duplicated here)
//   7. Sync templates
//
// Failures partway through are saved as partial state with a clear
// `registration_error`, exactly like the manual flow — never a
// silent drop, always something the user (or a retry) can act on.
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  exchangeEmbeddedSignupCode,
  getBusinessDetails,
  getWabaDetails,
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import { encrypt } from '@/lib/whatsapp/encryption'
import { checkPhoneNumberClaim } from '@/lib/whatsapp/claim-check'
import { whatsappAdminClient } from '@/lib/whatsapp/admin-client'
import { syncTemplatesFromMeta } from '@/lib/whatsapp/template-sync'
import {
  describeEmbeddedSignupError,
  generateRegistrationPin,
  isPinMismatchError,
} from '@/lib/whatsapp/embedded-signup'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const limit = checkRateLimit(
      `whatsapp:embeddedSignup:${user.id}`,
      RATE_LIMITS.adminAction,
    )
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

    const body = (await request.json().catch(() => null)) as {
      code?: unknown
      wabaId?: unknown
      phoneNumberId?: unknown
      businessId?: unknown
    } | null

    const code = typeof body?.code === 'string' ? body.code : ''
    const wabaId = typeof body?.wabaId === 'string' ? body.wabaId : ''
    const phoneNumberId = typeof body?.phoneNumberId === 'string' ? body.phoneNumberId : ''
    const businessId = typeof body?.businessId === 'string' ? body.businessId : undefined

    if (!code || !wabaId || !phoneNumberId) {
      return NextResponse.json(
        { error: "'code', 'wabaId', and 'phoneNumberId' are required" },
        { status: 400 },
      )
    }

    const appId = process.env.META_APP_ID
    const appSecret = process.env.META_APP_SECRET
    if (!appId || !appSecret) {
      console.error('[embedded-signup] META_APP_ID / META_APP_SECRET not configured')
      return NextResponse.json(
        { error: 'WhatsApp Embedded Signup is not configured on this server.' },
        { status: 500 },
      )
    }

    // Reject up-front if another organization already owns this
    // number — same check (and same underlying constraint) the
    // manual flow uses, before spending a Meta API call on it.
    let claim
    try {
      claim = await checkPhoneNumberClaim(whatsappAdminClient(), phoneNumberId, accountId)
    } catch (err) {
      console.error('[embedded-signup] claim check failed:', err)
      return NextResponse.json({ error: 'Failed to validate configuration' }, { status: 500 })
    }
    if (claim.claimedByAnotherAccount) {
      return NextResponse.json(
        {
          error:
            'This WhatsApp number is already connected to another organization on Growth Saints. Each number can only be connected once.',
        },
        { status: 409 },
      )
    }

    // Step 1 — exchange the short-lived code for a long-lived token.
    let accessToken: string
    try {
      const exchange = await exchangeEmbeddedSignupCode({ appId, appSecret, code })
      accessToken = exchange.accessToken
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[embedded-signup] code exchange failed:', message)
      return NextResponse.json({ error: describeEmbeddedSignupError(message) }, { status: 400 })
    }

    // Step 2 — fetch + verify phone metadata. Also confirms the
    // exchanged token actually works before we write anything.
    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({ phoneNumberId, accessToken })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[embedded-signup] phone metadata fetch failed:', message)
      return NextResponse.json({ error: describeEmbeddedSignupError(message) }, { status: 400 })
    }

    // Step 3 — register for inbound webhooks with a freshly generated
    // PIN. A brand-new Embedded-Signup number has no PIN yet, so this
    // is the zero-touch path. An existing number migrated in with its
    // own 2FA PIN will reject this — that's the one case automatic
    // setup can't finish alone (see isPinMismatchError below).
    let registeredAt: string | null = null
    let registrationError: string | null = null
    try {
      await registerPhoneNumber({
        phoneNumberId,
        accessToken,
        pin: generateRegistrationPin(),
      })
      registeredAt = new Date().toISOString()
    } catch (err) {
      registrationError = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[embedded-signup] /register failed:', registrationError)
      // Fall through — we still save the connection with whatever
      // succeeded, same partial-save pattern as the manual flow.
    }

    // Step 4 — subscribe the WABA to our app's webhook. Idempotent.
    let subscribedAppsAt: string | null = null
    try {
      await subscribeWabaToApp({ wabaId, accessToken })
      subscribedAppsAt = new Date().toISOString()
    } catch (err) {
      console.warn(
        '[embedded-signup] subscribed_apps failed (non-fatal):',
        err instanceof Error ? err.message : err,
      )
    }

    // Step 5 — resolve a human-readable business name: prefer the
    // Business Manager entity name when we have a business_id, fall
    // back to the WABA's own name.
    let businessName: string | null = null
    try {
      if (businessId) {
        const biz = await getBusinessDetails({ businessId, accessToken })
        businessName = biz.name ?? null
      }
      if (!businessName) {
        const waba = await getWabaDetails({ wabaId, accessToken })
        businessName = waba.name ?? null
      }
    } catch (err) {
      console.warn(
        '[embedded-signup] business/WABA name lookup failed (non-fatal):',
        err instanceof Error ? err.message : err,
      )
    }

    // Step 6 — persist. Token encrypted exactly like the manual flow.
    // No verify_token — Embedded Signup rows verify via the shared
    // META_WEBHOOK_VERIFY_TOKEN fast path in the webhook route.
    // Written through the RLS-scoped client, so the existing
    // admin-only whatsapp_config_insert/update policies (017) gate
    // this exactly like the manual save does.
    const nowIso = new Date().toISOString()
    const row = {
      phone_number_id: phoneNumberId,
      waba_id: wabaId,
      business_id: businessId ?? null,
      access_token: encrypt(accessToken),
      verify_token: null,
      status: registrationError ? 'disconnected' : 'connected',
      connected_at: registrationError ? null : nowIso,
      registered_at: registeredAt,
      subscribed_apps_at: subscribedAppsAt,
      last_registration_error: registrationError,
      display_phone_number: phoneInfo.display_phone_number ?? null,
      display_name: phoneInfo.verified_name ?? null,
      quality_rating: phoneInfo.quality_rating ?? null,
      messaging_limit_tier: phoneInfo.whatsapp_business_manager_messaging_limit ?? null,
      code_verification_status: phoneInfo.code_verification_status ?? null,
      business_name: businessName,
      onboarding_method: 'embedded_signup',
      last_synced_at: nowIso,
      updated_at: nowIso,
    }

    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()

    if (existing) {
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update(row)
        .eq('account_id', accountId)
      if (updateError) {
        console.error('[embedded-signup] update failed:', updateError)
        return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
      }
    } else {
      const { error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({ account_id: accountId, user_id: user.id, ...row })
      if (insertError) {
        console.error('[embedded-signup] insert failed:', insertError)
        return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
      }
    }

    // Step 7 — sync templates. Best-effort: a failure here doesn't
    // undo an otherwise-successful connection.
    let templatesSynced = 0
    try {
      const sync = await syncTemplatesFromMeta({
        supabase,
        accountId,
        userId: user.id,
        wabaId,
        accessToken,
      })
      templatesSynced = sync.total
    } catch (err) {
      console.warn(
        '[embedded-signup] template sync failed (non-fatal):',
        err instanceof Error ? err.message : err,
      )
    }

    if (registrationError) {
      return NextResponse.json({
        success: false,
        connected: true,
        registered: false,
        registration_error: describeEmbeddedSignupError(registrationError),
        pin_mismatch: isPinMismatchError(registrationError),
        phone_info: phoneInfo,
        business_name: businessName,
        templates_synced: templatesSynced,
      })
    }

    return NextResponse.json({
      success: true,
      connected: true,
      registered: true,
      phone_info: phoneInfo,
      business_name: businessName,
      templates_synced: templatesSynced,
    })
  } catch (error) {
    console.error('[embedded-signup] unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
