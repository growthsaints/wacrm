// Normalized shapes both platform clients (woocommerce.ts, shopify.ts)
// map their raw API responses into, so sync.ts and the webhook routes
// have exactly one shape to upsert regardless of platform.

export interface NormalizedCustomer {
  externalId: string
  email: string | null
  phone: string | null
  name: string | null
  totalSpent: number
  ordersCount: number
}

export interface NormalizedLineItem {
  productId: string | null
  name: string
  quantity: number
  price: number
}

export type CommerceOrderStatus =
  | 'created'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'

export interface NormalizedOrder {
  externalId: string
  orderNumber: string | null
  status: CommerceOrderStatus
  paymentStatus: string | null
  shippingStatus: string | null
  total: number
  currency: string
  customerEmail: string | null
  customerPhone: string | null
  lineItems: NormalizedLineItem[]
  placedAt: string | null
}

export interface NormalizedProduct {
  externalId: string
  name: string
  sku: string | null
  price: number | null
  currency: string | null
  imageUrl: string | null
  inventoryQty: number | null
}

export interface NormalizedCartEvent {
  externalId: string
  email: string | null
  phone: string | null
  cartValue: number
  currency: string
  lineItems: NormalizedLineItem[]
  status: 'open' | 'abandoned' | 'recovered' | 'converted'
}
