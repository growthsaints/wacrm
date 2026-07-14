/**
 * WooCommerce REST API v3 client.
 * Docs: https://woocommerce.github.io/woocommerce-rest-api-docs/
 *
 * Auth: consumer key/secret as HTTP Basic auth (WooCommerce's
 * documented approach for any store not on plain HTTP — Basic Auth
 * over TLS is what the wizard is designed around; a plain-HTTP store
 * would need query-string auth instead, which we don't support here
 * since it's explicitly discouraged by WooCommerce itself).
 */

import type {
  CommerceOrderStatus,
  NormalizedCustomer,
  NormalizedLineItem,
  NormalizedOrder,
  NormalizedProduct,
} from './types'

export interface WooCommerceCredentials {
  storeUrl: string
  consumerKey: string
  consumerSecret: string
}

function authHeader(creds: WooCommerceCredentials): string {
  const token = Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString('base64')
  return `Basic ${token}`
}

function apiBase(storeUrl: string): string {
  return `${storeUrl.replace(/\/+$/, '')}/wp-json/wc/v3`
}

async function wooFetch(
  creds: WooCommerceCredentials,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${apiBase(creds.storeUrl)}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(creds),
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  })
}

/** Connection wizard's "API Validation" step — a cheap authenticated
 *  call that fails fast on bad credentials or an unreachable store. */
export async function testWooCommerceConnection(
  creds: WooCommerceCredentials,
): Promise<{ ok: true; storeName?: string } | { ok: false; error: string }> {
  try {
    const res = await wooFetch(creds, '/system_status')
    if (!res.ok) {
      return { ok: false, error: `WooCommerce API returned ${res.status}` }
    }
    const data = await res.json().catch(() => ({}))
    return { ok: true, storeName: data?.environment?.site_url }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' }
  }
}

const WOO_TOPICS = [
  'order.created',
  'order.updated',
  'customer.created',
  'customer.updated',
] as const

/**
 * Registers our webhook endpoint with the store via WooCommerce's own
 * REST API — no manual client-side webhook setup (Part 4's "No manual
 * webhook configuration for clients"). Idempotent: WooCommerce allows
 * duplicate registrations, so a re-run just adds harmless extra rows;
 * callers only do this once at connection time.
 */
export async function registerWooCommerceWebhooks(
  creds: WooCommerceCredentials,
  deliveryUrl: string,
  secret: string,
): Promise<{ registered: number; errors: string[] }> {
  let registered = 0
  const errors: string[] = []
  for (const topic of WOO_TOPICS) {
    try {
      const res = await wooFetch(creds, '/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          name: `Growth Saints CRM — ${topic}`,
          topic,
          delivery_url: deliveryUrl,
          secret,
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

export async function fetchWooCommerceOrders(
  creds: WooCommerceCredentials,
  page = 1,
  perPage = 50,
): Promise<NormalizedOrder[]> {
  const res = await wooFetch(creds, `/orders?page=${page}&per_page=${perPage}&orderby=date&order=desc`)
  if (!res.ok) throw new Error(`WooCommerce orders fetch failed: ${res.status}`)
  const rows = (await res.json()) as Record<string, unknown>[]
  return rows.map(mapWooOrder)
}

export async function fetchWooCommerceCustomers(
  creds: WooCommerceCredentials,
  page = 1,
  perPage = 50,
): Promise<NormalizedCustomer[]> {
  const res = await wooFetch(creds, `/customers?page=${page}&per_page=${perPage}`)
  if (!res.ok) throw new Error(`WooCommerce customers fetch failed: ${res.status}`)
  const rows = (await res.json()) as Record<string, unknown>[]
  return rows.map(mapWooCustomer)
}

export async function fetchWooCommerceProducts(
  creds: WooCommerceCredentials,
  page = 1,
  perPage = 50,
): Promise<NormalizedProduct[]> {
  const res = await wooFetch(creds, `/products?page=${page}&per_page=${perPage}`)
  if (!res.ok) throw new Error(`WooCommerce products fetch failed: ${res.status}`)
  const rows = (await res.json()) as Record<string, unknown>[]
  return rows.map(mapWooProduct)
}

const WOO_STATUS_MAP: Record<string, CommerceOrderStatus> = {
  pending: 'created',
  processing: 'processing',
  'on-hold': 'processing',
  completed: 'delivered',
  cancelled: 'cancelled',
  refunded: 'refunded',
  failed: 'cancelled',
}

export function mapWooOrder(raw: Record<string, unknown>): NormalizedOrder {
  const billing = (raw.billing ?? {}) as Record<string, unknown>
  const lineItems = (raw.line_items as Record<string, unknown>[] | undefined) ?? []
  const wooStatus = String(raw.status ?? 'pending')
  return {
    externalId: String(raw.id),
    orderNumber: raw.number ? String(raw.number) : null,
    status: WOO_STATUS_MAP[wooStatus] ?? 'created',
    paymentStatus: (raw.date_paid as string | null) ? 'paid' : 'unpaid',
    shippingStatus: null,
    total: Number(raw.total ?? 0),
    currency: String(raw.currency ?? 'USD'),
    customerEmail: (billing.email as string | undefined) ?? null,
    customerPhone: (billing.phone as string | undefined) ?? null,
    lineItems: lineItems.map(
      (li): NormalizedLineItem => ({
        productId: li.product_id != null ? String(li.product_id) : null,
        name: String(li.name ?? ''),
        quantity: Number(li.quantity ?? 1),
        price: Number(li.price ?? li.total ?? 0),
      }),
    ),
    placedAt: (raw.date_created as string | undefined) ?? null,
  }
}

function mapWooCustomer(raw: Record<string, unknown>): NormalizedCustomer {
  const billing = (raw.billing ?? {}) as Record<string, unknown>
  const first = (raw.first_name as string | undefined) ?? ''
  const last = (raw.last_name as string | undefined) ?? ''
  return {
    externalId: String(raw.id),
    email: (raw.email as string | undefined) ?? null,
    phone: (billing.phone as string | undefined) ?? null,
    name: [first, last].filter(Boolean).join(' ') || null,
    totalSpent: Number(raw.total_spent ?? 0),
    ordersCount: Number(raw.orders_count ?? 0),
  }
}

/** Verifies WooCommerce's HMAC signature on an inbound webhook body
 *  (X-WC-Webhook-Signature — base64 HMAC-SHA256, same mechanism
 *  Shopify uses). */
export async function verifyWooCommerceWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const computed = Buffer.from(sig).toString('base64')
  return computed === signatureHeader
}

function mapWooProduct(raw: Record<string, unknown>): NormalizedProduct {
  const images = (raw.images as Record<string, unknown>[] | undefined) ?? []
  return {
    externalId: String(raw.id),
    name: String(raw.name ?? ''),
    sku: (raw.sku as string | undefined) || null,
    price: raw.price != null ? Number(raw.price) : null,
    currency: null,
    imageUrl: (images[0]?.src as string | undefined) ?? null,
    inventoryQty: raw.stock_quantity != null ? Number(raw.stock_quantity) : null,
  }
}
