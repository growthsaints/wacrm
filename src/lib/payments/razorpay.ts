// ============================================================
// Razorpay payment-gateway adapter — signature verification + event
// normalization for `POST /api/v1/payments/webhook/{configId}`.
//
// Razorpay signs the raw webhook body with the merchant's own
// dashboard-configured webhook secret: `X-Razorpay-Signature: <hex>`,
// where `<hex> = HMAC-SHA256(secret, rawBody)` (hex digest, unlike
// Meta's `sha256=<hex>`-prefixed header or Shopify's base64 digest —
// each platform's convention is genuinely different, which is exactly
// why this lives behind the `PaymentGatewayAdapter` interface instead
// of a shared signature helper).
//
// Reference (Razorpay Webhooks): the payload envelope is
//   { entity: "event", event: "payment.captured", payload: { payment: { entity: {...} } }, created_at }
// Docs: https://razorpay.com/docs/webhooks/
// ============================================================

import crypto from 'node:crypto';
import type { PaymentGatewayAdapter, ParsedGatewayEvent } from './gateway';
import type { NotificationEvent } from '@/lib/notifications/events';

/** Razorpay event names we act on, mapped to wacrm's own vocabulary. */
const EVENT_MAP: Record<string, NotificationEvent> = {
  'payment.captured': 'payment.captured',
  'payment.failed': 'payment.failed',
  'refund.created': 'payment.refunded',
  'refund.processed': 'payment.refunded',
};

interface RazorpayEntity {
  id?: string;
  amount?: number;
  currency?: string;
  email?: string;
  contact?: string;
  order_id?: string;
  payment_id?: string;
  notes?: Record<string, unknown>;
}

interface RazorpayPayload {
  event?: string;
  payload?: {
    payment?: { entity?: RazorpayEntity };
    refund?: { entity?: RazorpayEntity };
  };
}

/** Paise (or the currency's smallest unit) → a 2-decimal display string. */
function formatAmount(amount: number | undefined): string {
  if (typeof amount !== 'number') return '';
  return (amount / 100).toFixed(2);
}

/**
 * A phone number in Razorpay's payload is either the payment's own
 * `contact` field or a merchant-supplied `notes.phone` — `notes` is a
 * free-form key/value bag merchants attach at checkout, so this is a
 * convention, not a Razorpay guarantee.
 */
function extractPhone(entity: RazorpayEntity | undefined): string | null {
  if (!entity) return null;
  if (entity.contact) return entity.contact;
  const notesPhone = entity.notes?.phone;
  return typeof notesPhone === 'string' ? notesPhone : null;
}

export const razorpayAdapter: PaymentGatewayAdapter = {
  verifySignature(rawBody, headers, secret) {
    const signature = headers.get('x-razorpay-signature');
    if (!signature) return false;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    // Bail if lengths differ — timingSafeEqual throws otherwise.
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  },

  parseEvent(rawBody): ParsedGatewayEvent | null {
    let parsed: RazorpayPayload;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return null;
    }

    const rzpEvent = parsed.event ?? '';
    const event = EVENT_MAP[rzpEvent] ?? null;

    const isRefund = rzpEvent.startsWith('refund.');
    const entity = isRefund
      ? parsed.payload?.refund?.entity
      : parsed.payload?.payment?.entity;

    const phone = extractPhone(entity) ?? extractPhone(parsed.payload?.payment?.entity);

    const data: Record<string, unknown> = {
      payment: {
        id: entity?.id ?? entity?.payment_id ?? '',
        amount: formatAmount(entity?.amount),
        currency: entity?.currency ?? '',
        email: entity?.email ?? '',
        contact: entity?.contact ?? '',
        order_id: entity?.order_id ?? '',
      },
    };

    return {
      event,
      phone,
      data,
      eventId: entity?.id ?? null,
    };
  },
};
