import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/commerce/admin-client'
import { encrypt } from '@/lib/whatsapp/encryption'
import { testWooCommerceConnection, registerWooCommerceWebhooks } from '@/lib/commerce/woocommerce'
import { testShopifyConnection, registerShopifyWebhooks } from '@/lib/commerce/shopify'

/**
 * GET  /api/commerce/connections — list this account's connections
 *      (credentials never included in the response).
 * POST /api/commerce/connections — the connection wizard's single
 *      step: validates credentials against the real store API,
 *      registers our webhook with the store (no manual client-side
 *      webhook setup), stores encrypted credentials, and queues the
 *      initial full sync.
 */

const CONNECTION_SELECT =
  'id, platform, store_url, status, last_error, last_synced_at, created_at'

export async function GET() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('commerce_connections')
    .select(CONNECTION_SELECT)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ connections: data ?? [] })
}

interface PostBody {
  platform?: 'woocommerce' | 'shopify'
  store_url?: string
  consumer_key?: string
  consumer_secret?: string
  access_token?: string
}

export async function POST(request: Request) {
  try {
    await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as PostBody | null
  if (!body?.platform || !body.store_url?.trim()) {
    return NextResponse.json({ error: 'platform and store_url are required' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const storeUrl = body.store_url.trim()
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  if (!appUrl) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_APP_URL is not configured — cannot register a reachable webhook.' },
      { status: 500 },
    )
  }

  let credentials: Record<string, string>
  let validation: { ok: true; storeName?: string } | { ok: false; error: string }

  if (body.platform === 'woocommerce') {
    if (!body.consumer_key || !body.consumer_secret) {
      return NextResponse.json(
        { error: 'consumer_key and consumer_secret are required for WooCommerce' },
        { status: 400 },
      )
    }
    credentials = { consumerKey: body.consumer_key, consumerSecret: body.consumer_secret }
    validation = await testWooCommerceConnection({
      storeUrl,
      consumerKey: body.consumer_key,
      consumerSecret: body.consumer_secret,
    })
  } else if (body.platform === 'shopify') {
    if (!body.access_token) {
      return NextResponse.json({ error: 'access_token is required for Shopify' }, { status: 400 })
    }
    credentials = { accessToken: body.access_token }
    validation = await testShopifyConnection({ storeUrl, accessToken: body.access_token })
  } else {
    return NextResponse.json({ error: 'platform must be woocommerce or shopify' }, { status: 400 })
  }

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 422 })
  }

  const webhookSecret = crypto.randomUUID()
  const { data: conn, error: insErr } = await admin
    .from('commerce_connections')
    .insert({
      account_id: accountId,
      user_id: user.id,
      platform: body.platform,
      store_url: storeUrl,
      encrypted_credentials: encrypt(JSON.stringify(credentials)),
      webhook_secret: webhookSecret,
      status: 'connected',
    })
    .select(CONNECTION_SELECT)
    .single()
  if (insErr || !conn) {
    // Unique violation → one connection per platform per account already exists.
    const msg = insErr?.message?.includes('duplicate key')
      ? `A ${body.platform} connection already exists for this account.`
      : insErr?.message ?? 'Failed to save connection'
    return NextResponse.json({ error: msg }, { status: 409 })
  }

  const deliveryUrl =
    body.platform === 'woocommerce'
      ? `${appUrl}/api/commerce/woocommerce/webhook/${conn.id}`
      : `${appUrl}/api/commerce/shopify/webhook/${conn.id}`

  const registration =
    body.platform === 'woocommerce'
      ? await registerWooCommerceWebhooks(
          { storeUrl, consumerKey: body.consumer_key!, consumerSecret: body.consumer_secret! },
          deliveryUrl,
          webhookSecret,
        )
      : await registerShopifyWebhooks({ storeUrl, accessToken: body.access_token! }, deliveryUrl)

  if (registration.errors.length > 0) {
    await admin
      .from('commerce_connections')
      .update({ last_error: registration.errors.join('; ') })
      .eq('id', conn.id)
  }

  // Queue the initial full sync rather than blocking this request —
  // a store with thousands of orders would otherwise time out here.
  await admin.from('automation_jobs').insert({
    account_id: accountId,
    job_type: 'commerce_sync',
    payload: { connectionId: conn.id },
    idempotency_key: `commerce_sync:initial:${conn.id}`,
  })

  return NextResponse.json({ connection: conn, webhooksRegistered: registration.registered }, { status: 201 })
}
