/**
 * WhatsApp order notifications (Part 4/5's "Order Notifications" /
 * "Shipping Updates" / "Payment Updates"). Fires from the commerce
 * webhook routes after an order upsert. Best-effort: a failed send
 * (no session window open, WhatsApp not configured, contact unknown)
 * must not fail the webhook — Meta/the store would just retry
 * forever otherwise.
 */

import { supabaseAdmin } from './admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import type { CommerceOrderStatus } from './types'

const STATUS_TEXT: Record<CommerceOrderStatus, string> = {
  created: 'Your order {number} has been received. Total: {total} {currency}.',
  paid: 'Payment confirmed for order {number}. Thank you!',
  processing: 'Order {number} is being processed.',
  shipped: 'Order {number} has shipped.',
  delivered: 'Order {number} has been delivered. Enjoy!',
  cancelled: 'Order {number} was cancelled.',
  refunded: 'Order {number} has been refunded.',
}

export async function notifyOrderStatus(input: {
  accountId: string
  contactId: string | null
  orderNumber: string | null
  status: CommerceOrderStatus
  total: number
  currency: string
}): Promise<void> {
  if (!input.contactId) return
  const db = supabaseAdmin()

  try {
    const [{ data: contact }, { data: config }] = await Promise.all([
      db.from('contacts').select('id, phone').eq('id', input.contactId).eq('account_id', input.accountId).maybeSingle(),
      db.from('whatsapp_config').select('*').eq('account_id', input.accountId).maybeSingle(),
    ])
    if (!contact?.phone || !config) return

    const sanitized = sanitizePhoneForMeta(contact.phone as string)
    if (!isValidE164(sanitized)) return

    const text = STATUS_TEXT[input.status]
      .replace('{number}', input.orderNumber ?? '')
      .replace('{total}', input.total.toFixed(2))
      .replace('{currency}', input.currency)

    const accessToken = decrypt((config as { access_token: string }).access_token)
    await sendTextMessage({
      phoneNumberId: (config as { phone_number_id: string }).phone_number_id,
      accessToken,
      to: sanitized,
      text,
    })
  } catch (err) {
    console.error('[commerce] order notification failed:', err)
  }
}
