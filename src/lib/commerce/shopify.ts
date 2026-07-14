/**
 * Shopify Admin REST API client.
 * Docs: https://shopify.dev/docs/api/admin-rest
 *
 * Auth: a custom-app Admin API access token (X-Shopify-Access-Token
 * header) — the connection wizard asks for the store domain
 * (`{shop}.myshopify.com`) and the access token generated from the
 * store's own Admin → Apps → "Develop apps" page.
 */

import type {
  CommerceOrderStatus,
  NormalizedCustomer,
  NormalizedLineItem,
  NormalizedOrder,
  NormalizedProduct,
} from './types'

const SHOPIFY_API_VERSION = '2024-10'

export interface ShopifyCredentials {
  storeUrl: string // "{shop}.myshopify.com"
  accessToken: string
}

function apiBase(storeUrl: string): string {
  const shop = storeUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return `https://${shop}/admin/api/${SHOPIFY_API_VERSION}`
}

async function shopifyFetch(
  creds: ShopifyCredentials,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${apiBase(creds.storeUrl)}${path}`, {
    ...init,
    headers: {
      'X-Shopify-Access-Token': creds.accessToken,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  })
}

export async function testShopifyConnection(
  creds: ShopifyCredentials,
): Promise<{ ok: true; storeName?: string } | { ok: false; error: string }> {
  try {
    const res = await shopifyFetch(creds, '/shop.json')
    if (!res.ok) {
      return { ok: false, error: `Shopify API returned ${res.status}` }
    }
    const data = await res.json().catch(() => ({}))
    return { ok: true, storeName: data?.shop?.name }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' }
  }
}

const SHOPIFY_TOPICS = [
  'orders/create',
  'orders/updated',
  'orders/paid',
  'orders/cancelled',
  'orders/fulfilled',
  'customers/create',
  'customers/update',
  'checkouts/create',
  'checkouts/update',
] as const

/** Registers our webhook endpoint via Shopify's own Admin API — no
 *  manual client-side setup, mirrors the WooCommerce wizard step. */
export async function registerShopifyWebhooks(
  creds: ShopifyCredentials,
  deliveryUrl: string,
): Promise<{ registered: number; errors: string[] }> {
  let registered = 0
  const errors: string[] = []
  for (const topic of SHOPIFY_TOPICS) {
    try {
      const res = await shopifyFetch(creds, '/webhooks.json', {
        method: 'POST',
        body: JSON.stringify({
          webhook: { topic, address: deliveryUrl, format: 'json' },
        }),
      })
      if (res.ok) registered++
      else errors.push(`${topic}: HTTP ${res.status}`)
    } catch (err) {
      errors.push(`${topic}: ${err instanceof Error ? err.message : 'request failed'}`)
    }
  }
  return { registered, errors }
}

export async function fetchShopifyOrders(
  creds: ShopifyCredentials,
  limit = 50,
): Promise<NormalizedOrder[]> {
  const res = await shopifyFetch(creds, `/orders.json?status=any&limit=${limit}`)
  if (!res.ok) throw new Error(`Shopify orders fetch failed: ${res.status}`)
  const data = await res.json()
  return ((data.orders as Record<string, unknown>[]) ?? []).map(mapShopifyOrder)
}

export async function fetchShopifyCustomers(
  creds: ShopifyCredentials,
  limit = 50,
): Promise<NormalizedCustomer[]> {
  const res = await shopifyFetch(creds, `/customers.json?limit=${limit}`)
  if (!res.ok) throw new Error(`Shopify customers fetch failed: ${res.status}`)
  const data = await res.json()
  return ((data.customers as Record<string, unknown>[]) ?? []).map(mapShopifyCustomer)
}

export async function fetchShopifyProducts(
  creds: ShopifyCredentials,
  limit = 50,
): Promise<NormalizedProduct[]> {
  const res = await shopifyFetch(creds, `/products.json?limit=${limit}`)
  if (!res.ok) throw new Error(`Shopify products fetch failed: ${res.status}`)
  const data = await res.json()
  return ((data.products as Record<string, unknown>[]) ?? []).map(mapShopifyProduct)
}

function shopifyStatus(raw: Record<string, unknown>): CommerceOrderStatus {
  if (raw.cancelled_at) return 'cancelled'
  if (raw.fulfillment_status === 'fulfilled') return 'delivered'
  if (raw.fulfillment_status === 'partial') return 'shipped'
  if (raw.financial_status === 'refunded') return 'refunded'
  if (raw.financial_status === 'paid') return 'paid'
  return 'created'
}

export function mapShopifyOrder(raw: Record<string, unknown>): NormalizedOrder {
  const customer = (raw.customer ?? {}) as Record<string, unknown>
  const lineItems = (raw.line_items as Record<string, unknown>[] | undefined) ?? []
  return {
    externalId: String(raw.id),
    orderNumber: raw.name ? String(raw.name) : null,
    status: shopifyStatus(raw),
    paymentStatus: (raw.financial_status as string | undefined) ?? null,
    shippingStatus: (raw.fulfillment_status as string | undefined) ?? null,
    total: Number(raw.total_price ?? 0),
    currency: String(raw.currency ?? 'USD'),
    customerEmail: (raw.email as string | undefined) ?? (customer.email as string | undefined) ?? null,
    customerPhone: (raw.phone as string | undefined) ?? (customer.phone as string | undefined) ?? null,
    lineItems: lineItems.map(
      (li): NormalizedLineItem => ({
        productId: li.product_id != null ? String(li.product_id) : null,
        name: String(li.name ?? li.title ?? ''),
        quantity: Number(li.quantity ?? 1),
        price: Number(li.price ?? 0),
      }),
    ),
    placedAt: (raw.created_at as string | undefined) ?? null,
  }
}

function mapShopifyCustomer(raw: Record<string, unknown>): NormalizedCustomer {
  const first = (raw.first_name as string | undefined) ?? ''
  const last = (raw.last_name as string | undefined) ?? ''
  return {
    externalId: String(raw.id),
    email: (raw.email as string | undefined) ?? null,
    phone: (raw.phone as string | undefined) ?? null,
    name: [first, last].filter(Boolean).join(' ') || null,
    totalSpent: Number(raw.total_spent ?? 0),
    ordersCount: Number(raw.orders_count ?? 0),
  }
}

function mapShopifyProduct(raw: Record<string, unknown>): NormalizedProduct {
  const variants = (raw.variants as Record<string, unknown>[] | undefined) ?? []
  const images = (raw.images as Record<string, unknown>[] | undefined) ?? []
  const firstVariant = variants[0] ?? {}
  return {
    externalId: String(raw.id),
    name: String(raw.title ?? ''),
    sku: (firstVariant.sku as string | undefined) || null,
    price: firstVariant.price != null ? Number(firstVariant.price) : null,
    currency: null,
    imageUrl: (images[0]?.src as string | undefined) ?? null,
    inventoryQty:
      firstVariant.inventory_quantity != null ? Number(firstVariant.inventory_quantity) : null,
  }
}

/** Verifies Shopify's HMAC signature on an inbound webhook body. */
export async function verifyShopifyWebhookSignature(
  rawBody: string,
  hmacHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!hmacHeader) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const computed = Buffer.from(sig).toString('base64')
  return computed === hmacHeader
}
