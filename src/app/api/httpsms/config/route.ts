import crypto from 'node:crypto'
import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/httpsms/encryption'
import { verifyHttpSmsApiKey, registerHttpSmsWebhook, HttpSmsApiError } from '@/lib/httpsms/client'
import { normalizePhone, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { getBaseUrl } from '@/lib/http/base-url'

// Same reasoning as sms/config/route.ts's webhookUrl — request.url is
// the internal bind address behind a reverse proxy, not the public
// hostname. Uses lib/http/base-url.ts rather than repeating that bug.
function webhookUrl(request: Request, token: string): string {
  return `${getBaseUrl(request, 'httpsms/config webhookUrl')}/api/httpsms/webhook/${token}`
}

/**
 * GET /api/httpsms/config
 *
 * Lists every httpSMS number connected on the account. V1 supports one
 * (see lib/httpsms/conversation.ts), but the shape is list-based from
 * the start so a future multi-number round-robin (mirroring the SMS
 * Gateway integration's migration 080) doesn't need another rewrite.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data: configs, error } = await supabase
      .from('httpsms_config')
      .select('id, label, phone_number, webhook_token, status, enabled, connected_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[httpsms/config GET] fetch error:', error)
      return NextResponse.json({ numbers: [] }, { status: 200 })
    }

    const numbers = (configs ?? []).map((c) => ({
      id: c.id,
      label: c.label,
      phone_number: c.phone_number,
      webhook_url: webhookUrl(request, c.webhook_token),
      status: c.status,
      enabled: c.enabled,
      connected_at: c.connected_at,
    }))

    return NextResponse.json({ numbers })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/httpsms/config
 *
 * Connects a new httpSMS phone number. Verifies the API key reaches a
 * real httpSMS account before persisting (GET /phones — see
 * lib/httpsms/client.ts for why that endpoint specifically).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const body = await request.json()
    const { label, phone_number, api_key } = body

    if (!phone_number || !api_key) {
      return NextResponse.json({ error: 'phone_number and api_key are required' }, { status: 400 })
    }

    const normalizedPhone = normalizePhone(phone_number)
    if (!isValidE164(normalizedPhone)) {
      return NextResponse.json({ error: 'phone_number must be a valid phone number' }, { status: 400 })
    }

    try {
      await verifyHttpSmsApiKey(api_key)
    } catch (err) {
      const message = err instanceof HttpSmsApiError ? err.message : 'Unknown httpSMS error'
      return NextResponse.json({ error: `Could not connect to httpSMS: ${message}` }, { status: 400 })
    }

    const webhookToken = crypto.randomBytes(16).toString('hex')
    const webhookSecretRaw = crypto.randomBytes(32).toString('hex')
    const resolvedWebhookUrl = webhookUrl(request, webhookToken)

    // Auto-register the webhook against httpSMS's own API — saves the
    // manual "copy this URL into your httpSMS dashboard" step (see
    // lib/httpsms/client.ts's registerHttpSmsWebhook). Best-effort: a
    // failure here doesn't block connecting the number, since sending
    // still works without it — just note it in the response so the UI
    // can tell the admin to register it manually as a fallback.
    let webhookRegistered = true
    try {
      await registerHttpSmsWebhook(api_key, {
        url: resolvedWebhookUrl,
        signingKey: webhookSecretRaw,
        phoneNumber: `+${normalizedPhone}`,
      })
    } catch (err) {
      webhookRegistered = false
      console.error('[httpsms/config POST] webhook auto-registration failed:', err)
    }

    const { data: inserted, error: insertError } = await supabase
      .from('httpsms_config')
      .insert({
        account_id: accountId,
        user_id: userId,
        label: typeof label === 'string' && label.trim() ? label.trim() : 'httpSMS',
        phone_number: `+${normalizedPhone}`,
        api_key: encrypt(api_key),
        webhook_token: webhookToken,
        webhook_secret: encrypt(webhookSecretRaw),
        status: 'connected',
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (insertError || !inserted) {
      console.error('[httpsms/config POST] insert error:', insertError)
      const message =
        insertError?.code === '23505'
          ? 'This phone number is already connected on this account.'
          : 'Failed to save configuration'
      return NextResponse.json({ error: message }, { status: insertError?.code === '23505' ? 409 : 500 })
    }

    return NextResponse.json({
      success: true,
      id: inserted.id,
      webhook_url: resolvedWebhookUrl,
      webhook_registered: webhookRegistered,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
