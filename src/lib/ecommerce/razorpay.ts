// ============================================================
// Razorpay webhook receiver helpers — signature verification + event
// mapping into the shared `notifyForEvent` shape.
//
// Razorpay's signing scheme (unlike wacrm's own outbound X-Wacrm-
// Signature): `X-Razorpay-Signature` is the plain hex HMAC-SHA256 of
// the raw request body, keyed by the webhook secret configured in the
// Razorpay dashboard. No timestamp component, so no replay-window
// check — https://razorpay.com/docs/webhooks/validate-test/
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentEvent } from './events';

export function verifyRazorpaySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const presented = signatureHeader.trim().toLowerCase();
  if (expected.length !== presented.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(presented));
}

interface RazorpayPaymentEntity {
  id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  order_id?: unknown;
  method?: unknown;
  contact?: unknown;
  email?: unknown;
  notes?: unknown;
}

interface RazorpayRefundEntity {
  id?: unknown;
  amount?: unknown;
  payment_id?: unknown;
}

export interface MappedRazorpayEvent {
  event: PaymentEvent;
  to: string;
  name: string | null;
  data: unknown;
}

const RAZORPAY_EVENT_MAP: Record<string, PaymentEvent> = {
  'payment.captured': 'payment.captured',
  'payment.failed': 'payment.failed',
  'refund.processed': 'payment.refunded',
  'refund.created': 'payment.refunded',
};

function paiseToRupees(amount: unknown): number | null {
  return typeof amount === 'number' ? Math.round(amount) / 100 : null;
}

function notesCustomerName(notes: unknown): string | null {
  if (!notes || typeof notes !== 'object') return null;
  const value = (notes as Record<string, unknown>).customer_name;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Map a Razorpay webhook body into `{event, to, name, data}`, or
 * `null` if this event isn't one wacrm notifies on (unmapped event
 * type) or carries no usable contact (`payment.entity.contact`) to
 * notify. Both are "nothing to do", not errors — the receiver route
 * returns 200 either way so Razorpay doesn't retry indefinitely.
 */
export function mapRazorpayEvent(payload: unknown): MappedRazorpayEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;

  const eventName = typeof body.event === 'string' ? body.event : null;
  const mappedEvent = eventName ? RAZORPAY_EVENT_MAP[eventName] : undefined;
  if (!mappedEvent) return null;

  const payloadBlock = body.payload as Record<string, unknown> | undefined;
  const paymentEntity = (
    payloadBlock?.payment as { entity?: RazorpayPaymentEntity } | undefined
  )?.entity;
  const refundEntity = (
    payloadBlock?.refund as { entity?: RazorpayRefundEntity } | undefined
  )?.entity;

  const contact =
    typeof paymentEntity?.contact === 'string' ? paymentEntity.contact : null;
  if (!contact) return null;

  const data: Record<string, unknown> = {};
  if (paymentEntity) {
    data.payment = {
      id: typeof paymentEntity.id === 'string' ? paymentEntity.id : null,
      amount: paiseToRupees(paymentEntity.amount),
      amount_paise:
        typeof paymentEntity.amount === 'number' ? paymentEntity.amount : null,
      currency:
        typeof paymentEntity.currency === 'string'
          ? paymentEntity.currency
          : null,
      status:
        typeof paymentEntity.status === 'string' ? paymentEntity.status : null,
      order_id:
        typeof paymentEntity.order_id === 'string'
          ? paymentEntity.order_id
          : null,
      method:
        typeof paymentEntity.method === 'string' ? paymentEntity.method : null,
    };
  }
  if (refundEntity) {
    data.refund = {
      id: typeof refundEntity.id === 'string' ? refundEntity.id : null,
      amount: paiseToRupees(refundEntity.amount),
      amount_paise:
        typeof refundEntity.amount === 'number' ? refundEntity.amount : null,
      payment_id:
        typeof refundEntity.payment_id === 'string'
          ? refundEntity.payment_id
          : null,
    };
  }

  return {
    event: mappedEvent,
    to: contact,
    name: notesCustomerName(paymentEntity?.notes),
    data,
  };
}

/**
 * Natural idempotency key for a Razorpay delivery: Razorpay retries
 * on any non-2xx, so the same (payment/refund id, event) can arrive
 * more than once. Falls back to null when neither id is present
 * (receiver then skips the idempotency guard for that call).
 */
export function razorpayIdempotencyKey(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;
  const eventName = typeof body.event === 'string' ? body.event : 'unknown';
  const payloadBlock = body.payload as Record<string, unknown> | undefined;
  const paymentId = (
    payloadBlock?.payment as { entity?: { id?: unknown } } | undefined
  )?.entity?.id;
  const refundId = (
    payloadBlock?.refund as { entity?: { id?: unknown } } | undefined
  )?.entity?.id;
  const id =
    (typeof refundId === 'string' && refundId) ||
    (typeof paymentId === 'string' && paymentId) ||
    null;
  return id ? `razorpay:${eventName}:${id}` : null;
}
