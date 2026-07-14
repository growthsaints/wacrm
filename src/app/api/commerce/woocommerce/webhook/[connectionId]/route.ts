import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/commerce/admin-client'
import { mapWooOrder, verifyWooCommerceWebhookSignature } from '@/lib/commerce/woocommerce'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { dispatchEventToFlows } from '@/lib/flows/engine'
import { notifyOrderStatus } from '@/lib/commerce/notify'
import type { CommerceOrderStatus } from '@/lib/commerce/types'

/**
 * POST /api/commerce/woocommerce/webhook/[connectionId]
 *
 * WooCommerce delivers order.created / order.updated /
 * customer.created / customer.updated here — registered
 * automatically by the connection wizard
 * (registerWooCommerceWebhooks), never configured by hand.
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
    .eq('platform', 'woocommerce')
    .maybeSingle()
  if (!conn) {
    return NextResponse.json({ error: 'Unknown connection' }, { status: 404 })
  }

  const signature = request.headers.get('x-wc-webhook-signature')
  const valid = await verifyWooCommerceWebhookSignature(rawBody, signature, conn.webhook_secret)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const topic = request.headers.get('x-wc-webhook-topic') ?? ''
  const payload = JSON.parse(rawBody || '{}') as Record<string, unknown>

  if (topic.startsWith('order.')) {
    const order = mapWooOrder(payload)
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
  await dispatchEventToFlows({
    accountId,
    contactId,
    triggerType,
  }).catch((err) => console.error('[commerce] order trigger dispatch failed:', err))
}
