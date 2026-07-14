/**
 * Commerce sync — full product/customer/order pull for a connection,
 * queued via `automation_jobs` (job_type = 'commerce_sync') rather
 * than run synchronously from the connection wizard, since a store
 * with thousands of orders would otherwise time out the request that
 * created the connection.
 */

import { decrypt } from '@/lib/whatsapp/encryption'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { supabaseAdmin } from './admin-client'
import {
  fetchWooCommerceCustomers,
  fetchWooCommerceOrders,
  fetchWooCommerceProducts,
  type WooCommerceCredentials,
} from './woocommerce'
import {
  fetchShopifyCustomers,
  fetchShopifyOrders,
  fetchShopifyProducts,
  type ShopifyCredentials,
} from './shopify'
import type { NormalizedCustomer, NormalizedOrder, NormalizedProduct } from './types'

interface ConnectionRow {
  id: string
  account_id: string
  platform: 'woocommerce' | 'shopify'
  store_url: string
  encrypted_credentials: string
}

export async function runCommerceSyncJob(payload: { connectionId: string }): Promise<void> {
  const db = supabaseAdmin()
  const { data: conn } = await db
    .from('commerce_connections')
    .select('*')
    .eq('id', payload.connectionId)
    .maybeSingle()
  if (!conn) return
  const row = conn as ConnectionRow

  const creds = JSON.parse(decrypt(row.encrypted_credentials)) as Record<string, string>

  let customers: NormalizedCustomer[]
  let orders: NormalizedOrder[]
  let products: NormalizedProduct[]

  if (row.platform === 'woocommerce') {
    const wc: WooCommerceCredentials = {
      storeUrl: row.store_url,
      consumerKey: creds.consumerKey,
      consumerSecret: creds.consumerSecret,
    }
    ;[customers, orders, products] = await Promise.all([
      fetchWooCommerceCustomers(wc),
      fetchWooCommerceOrders(wc),
      fetchWooCommerceProducts(wc),
    ])
  } else {
    const sp: ShopifyCredentials = { storeUrl: row.store_url, accessToken: creds.accessToken }
    ;[customers, orders, products] = await Promise.all([
      fetchShopifyCustomers(sp),
      fetchShopifyOrders(sp),
      fetchShopifyProducts(sp),
    ])
  }

  for (const c of customers) {
    const contactId = c.phone ? (await findExistingContact(db, row.account_id, c.phone))?.id ?? null : null
    await db.from('commerce_customers').upsert(
      {
        account_id: row.account_id,
        connection_id: row.id,
        contact_id: contactId,
        external_customer_id: c.externalId,
        email: c.email,
        phone: c.phone,
        name: c.name,
        total_spent: c.totalSpent,
        orders_count: c.ordersCount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'connection_id,external_customer_id' },
    )
  }

  for (const p of products) {
    await db.from('commerce_products').upsert(
      {
        account_id: row.account_id,
        connection_id: row.id,
        external_product_id: p.externalId,
        name: p.name,
        sku: p.sku,
        price: p.price,
        currency: p.currency,
        image_url: p.imageUrl,
        inventory_qty: p.inventoryQty,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'connection_id,external_product_id' },
    )
  }

  for (const o of orders) {
    const phone = o.customerPhone
    const contactId = phone ? (await findExistingContact(db, row.account_id, phone))?.id ?? null : null
    await db.from('commerce_orders').upsert(
      {
        account_id: row.account_id,
        connection_id: row.id,
        contact_id: contactId,
        external_order_id: o.externalId,
        order_number: o.orderNumber,
        status: o.status,
        payment_status: o.paymentStatus,
        shipping_status: o.shippingStatus,
        total: o.total,
        currency: o.currency,
        customer_email: o.customerEmail,
        customer_phone: o.customerPhone,
        line_items: o.lineItems,
        placed_at: o.placedAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'connection_id,external_order_id' },
    )
  }

  await db
    .from('commerce_connections')
    .update({ last_synced_at: new Date().toISOString(), status: 'connected', last_error: null })
    .eq('id', row.id)
}
