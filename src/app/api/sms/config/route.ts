import crypto from 'node:crypto'
import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/sms/encryption'
import { verifyGatewayConnection, GatewayApiError } from '@/lib/sms/gateway-api'
import { countRecentSmsSentByDevice, SMS_DAILY_CAP } from '@/lib/sms/daily-quota'
import { getBaseUrl } from '@/lib/http/base-url'

// `new URL(path, request.url)` is NOT safe behind a reverse proxy
// (Hostinger/nginx) — request.url reflects the internal address Next.js
// is bound to (e.g. http://localhost:3000), not the public hostname.
// That produced unreachable "https://localhost:3000/api/sms/webhook/…"
// URLs in Settings → SMS, which silently breaks both delivery-status
// callbacks (sms:sent/delivered/failed) and inbound SMS (sms:received)
// from ever reaching this server — see lib/http/base-url.ts, which
// exists specifically to avoid this (same bug bit the invite-link flow
// and the Supabase auth callback redirect before it).
function webhookUrl(request: Request, token: string): string {
  return `${getBaseUrl(request, 'sms/config webhookUrl')}/api/sms/webhook/${token}`
}

/**
 * GET /api/sms/config
 *
 * Lists every SMS Gateway device on the account (migration 080 — an
 * account can have many, one per phone/SIM). Doesn't live-verify each
 * device's gateway connection on every list load (that's 1 HTTP call
 * per device — fine for one, not for twenty) — `status`/`enabled` are
 * the stored, last-known state; live verification happens at save time
 * (POST) instead.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data: configs, error } = await supabase
      .from('sms_config')
      .select('id, label, base_url, username, webhook_token, status, enabled, connected_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[sms/config GET] fetch error:', error)
      return NextResponse.json({ devices: [] }, { status: 200 })
    }

    const devices = await Promise.all(
      (configs ?? []).map(async (c) => ({
        id: c.id,
        label: c.label,
        base_url: c.base_url,
        username: c.username,
        webhook_url: webhookUrl(request, c.webhook_token),
        status: c.status,
        enabled: c.enabled,
        connected_at: c.connected_at,
        sent_today: await countRecentSmsSentByDevice(supabase, c.id).catch(() => 0),
        daily_cap: SMS_DAILY_CAP,
      })),
    )

    return NextResponse.json({ devices })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/sms/config
 *
 * Adds a NEW SMS Gateway device to the account (does not update an
 * existing one — see PATCH /api/sms/config/{id} for that). Verifies the
 * credentials reach a real gateway before persisting. Every device gets
 * its own webhook_token/secret, so each Android app instance is pointed
 * at a distinct webhook URL and inbound routing never has to guess
 * which device a webhook call came from.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const body = await request.json()
    const { label, base_url, username, password } = body

    if (!base_url || !username || !password) {
      return NextResponse.json(
        { error: 'base_url, username, and password are required' },
        { status: 400 },
      )
    }

    let normalizedBaseUrl: string
    try {
      normalizedBaseUrl = new URL(base_url).toString().replace(/\/+$/, '')
    } catch {
      return NextResponse.json({ error: 'base_url must be a valid URL' }, { status: 400 })
    }

    try {
      await verifyGatewayConnection({ baseUrl: normalizedBaseUrl, username, password })
    } catch (err) {
      const message = err instanceof GatewayApiError ? err.message : 'Unknown gateway error'
      return NextResponse.json({ error: `Could not connect to SMS gateway: ${message}` }, { status: 400 })
    }

    const webhookToken = crypto.randomBytes(16).toString('hex')
    const webhookSecret = encrypt(crypto.randomBytes(32).toString('hex'))

    const { data: inserted, error: insertError } = await supabase
      .from('sms_config')
      .insert({
        account_id: accountId,
        user_id: userId,
        label: typeof label === 'string' && label.trim() ? label.trim() : 'SMS Gateway',
        base_url: normalizedBaseUrl,
        username,
        password: encrypt(password),
        webhook_token: webhookToken,
        webhook_secret: webhookSecret,
        status: 'connected',
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (insertError || !inserted) {
      console.error('[sms/config POST] insert error:', insertError)
      return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      id: inserted.id,
      webhook_url: webhookUrl(request, webhookToken),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
