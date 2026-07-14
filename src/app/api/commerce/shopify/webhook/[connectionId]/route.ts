import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/commerce/admin-client'
import { mapShopifyOrder, verifyShopifyWebhookSignature } from '@/lib/commerce/shopify'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { dispatchEventToFlows } from '@/lib/flows/engine'
import { notifyOrderStatus } from '@/lib/commerce/notify'
import type { CommerceOrderStatus } from '@/lib/commerce/types'

/**
 * POST /api/commerce/shopify/webhook/[connectionId]
 *
 * Handles orders/create, orders/updated, orders/paid, orders/cancelled,
 * orders/fulfilled, customers/create, customers/update, checkouts/create,
 * checkouts/update — registered automatically by the connection wizard
 * (registerShopifyWebhooks), never configured by hand.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await context.params
  const rawBody = await request.text()

  const admin = supabaseAdmin()
  const { data: conn } = await admin
    .from('commerce_connections')
    .select('*')
    .eq('id', connectionId)
    .eq('platform', 'shopify')
    .maybeSingle()
  if (!conn) {
    return NextResponse.json({ error: 'Unknown connection' }, { status: 404 })
  }

  const hmac = request.headers.get('x-shopify-hmac-sha256')
  const valid = await verifyShopifyWebhookSignature(rawBody, hmac, conn.webhook_secret)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const topic = request.headers.get('x-shopify-topic') ?? ''
  const payload = JSON.parse(rawBody || '{}') as Record<string, unknown>

  if (topic.startsWith('orders/')) {
    const order = mapShopifyOrder(payload)
    const contactId = order.customerPhone
      ? (await findExistingContact(admin, conn.account_id, order.customerPhone))?.id ?? null
      : null

    const { data: existing } = await admin
      .from('commerce_orders')
      .select('status')
      .eq('connection_id', conn.id)
      .eq('external_order_id', order.externalId)
      .maybeSingle()
    const statusChanged = !existing || existing.status !== order.status

    await admin.from('commerce_orders').upsert(
      {
        account_id: conn.account_id,
        connection_id: conn.id,
        contact_id: contactId,
        external_order_id: order.externalId,
        order_number: order.orderNumber,
        status: order.status,
        payment_status: order.paymentStatus,
        shipping_status: order.shippingStatus,
        total: order.total,
        currency: order.currency,
        customer_email: order.customerEmail,
        customer_phone: order.customerPhone,
        line_items: order.lineItems,
        placed_at: order.placedAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'connection_id,external_order_id' },
    )

    if (statusChanged && contactId) {
      await fireOrderTrigger(conn.account_id, contactId, order.status)
      await notifyOrderStatus({
        accountId: conn.account_id,
        contactId,
        orderNumber: order.orderNumber,
        status: order.status,
        total: order.total,
        currency: order.currency,
      })
    }
  } else if (topic.startsWith('checkouts/')) {
    // Abandoned cart — Shopify's own checkout lifecycle. A checkout
    // stays 'open' until it converts to an order or Shopify's own
    // abandonment window elapses; we record it as-is and let the
    // account's automation (trigger_type would need an abandoned-cart
    // event to act on it — out of scope for this pass, see the
    // migration's comment on commerce_cart_events) surface it.
    const email = (payload.email as string | undefined) ?? null
    const phone = (payload.phone as string | undefined) ?? null
    const contactId = phone
      ? (await findExistingContact(admin, conn.account_id, phone))?.id ?? null
      : null
    const lineItems = ((payload.line_items as Record<string, unknown>[] | undefined) ?? []).map(
      (li) => ({
        productId: li.product_id != null ? String(li.product_id) : null,
        name: String(li.title ?? ''),
        quantity: Number(li.quantity ?? 1),
        price: Number(li.price ?? 0),
      }),
    )
    await admin.from('commerce_cart_events').upsert(
      {
        account_id: conn.account_id,
        connection_id: conn.id,
        contact_id: contactId,
        external_checkout_id: String(payload.token ?? payload.id ?? ''),
        email,
        phone,
        cart_value: Number(payload.total_price ?? 0),
        currency: String(payload.currency ?? 'USD'),
        line_items: lineItems,
        status: payload.completed_at ? 'converted' : 'open',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'connection_id,external_checkout_id' },
    )
  }

  return NextResponse.json({ ok: true })
}

async function fireOrderTrigger(
  accountId: string,
  contactId: string,
  status: CommerceOrderStatus,
): Promise<void> {
  const triggerMap: Partial<Record<CommerceOrderStatus, 'order_created' | 'order_paid' | 'order_delivered' | 'order_cancelled'>> = {
    created: 'order_created',
    paid: 'order_paid',
    delivered: 'order_delivered',
    cancelled: 'order_cancelled',
  }
  const triggerType = triggerMap[status]
  if (!triggerType) return
  await dispatchEventToFlows({ accountId, contactId, triggerType }).catch((err) =>
    console.error('[commerce] order trigger dispatch failed:', err),
  )
}
