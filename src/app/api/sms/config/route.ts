import crypto from 'node:crypto'
import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt, decrypt } from '@/lib/sms/encryption'
import { verifyGatewayConnection, GatewayApiError } from '@/lib/sms/gateway-api'

function webhookUrl(request: Request, token: string): string {
  return new URL(`/api/sms/webhook/${token}`, request.url).toString()
}

/**
 * GET /api/sms/config
 *
 * Mirrors /api/whatsapp/config's GET: used by the settings page to show
 * connection status and by the "Test Connection" button. Returns 200 in
 * every non-auth case so the UI can render a message instead of a 500.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data: config, error } = await supabase
      .from('sms_config')
      .select('base_url, username, password, webhook_token, status')
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[sms/config GET] fetch error:', error)
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: 'Failed to fetch configuration' },
        { status: 200 },
      )
    }

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: 'No SMS gateway configured yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 },
      )
    }

    let password: string
    try {
      password = decrypt(config.password)
    } catch (err) {
      console.error('[sms/config GET] password decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'The stored gateway password cannot be decrypted with the current ENCRYPTION_KEY. Reset and re-save the configuration.',
        },
        { status: 200 },
      )
    }

    try {
      await verifyGatewayConnection({ baseUrl: config.base_url, username: config.username, password })
      return NextResponse.json({
        connected: true,
        base_url: config.base_url,
        username: config.username,
        webhook_url: webhookUrl(request, config.webhook_token),
      })
    } catch (err) {
      const message = err instanceof GatewayApiError ? err.message : 'Unknown gateway error'
      return NextResponse.json(
        { connected: false, reason: 'gateway_error', message },
        { status: 200 },
      )
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/sms/config
 *
 * Saves or updates the account's SMS gateway config. Verifies the
 * credentials reach a real gateway before persisting. `webhook_token`
 * is generated once (on first insert) and stays stable across re-saves
 * so the URL the user pastes into the Android app doesn't change.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const body = await request.json()
    const { base_url, username, password } = body

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

    const { data: existing } = await supabase
      .from('sms_config')
      .select('id, webhook_token, webhook_secret')
      .eq('account_id', accountId)
      .maybeSingle()

    const webhookToken = existing?.webhook_token ?? crypto.randomBytes(16).toString('hex')
    const webhookSecret = existing?.webhook_secret ?? encrypt(crypto.randomBytes(32).toString('hex'))

    const row = {
      base_url: normalizedBaseUrl,
      username,
      password: encrypt(password),
      webhook_token: webhookToken,
      webhook_secret: webhookSecret,
      status: 'connected',
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('sms_config')
        .update(row)
        .eq('account_id', accountId)
      if (updateError) {
        console.error('[sms/config POST] update error:', updateError)
        return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 })
      }
    } else {
      const { error: insertError } = await supabase
        .from('sms_config')
        .insert({ account_id: accountId, user_id: userId, ...row })
      if (insertError) {
        console.error('[sms/config POST] insert error:', insertError)
        return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
      }
    }

    return NextResponse.json({
      success: true,
      webhook_url: webhookUrl(request, webhookToken),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/sms/config
 *
 * Removes the account's SMS gateway configuration.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { error } = await supabase.from('sms_config').delete().eq('account_id', accountId)
    if (error) {
      console.error('[sms/config DELETE] delete error:', error)
      return NextResponse.json({ error: 'Failed to delete configuration' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
