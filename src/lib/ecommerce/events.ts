// ============================================================
// Ecommerce notification event vocabulary — pure, no I/O.
//
// Three sub-vocabularies, all sharing one `notification_rules` table
// (docs/ecommerce-integration.md):
//
//   ORDER_EVENTS   — the `event` a caller can send to
//                    POST /api/v1/ecommerce/webhook directly.
//   PAYMENT_EVENTS — emitted internally by the Razorpay receiver
//                    (POST /api/webhooks/razorpay/{configId}).
//   SHIPMENT_EVENTS — the `event` a caller can send to
//                    POST /api/webhooks/shipping/{configId}.
//
// `notification_rules.event` accepts anything in the union — one rule
// row per event, whichever trigger produces it. Adding an event is a
// code change here (the column is free `text`), same model as API
// scopes and outbound webhook events.
// ============================================================

export const ORDER_EVENTS = [
  'order.created',
  'order.paid',
  'order.processing',
  'order.shipped',
  'order.delivered',
  'order.cancelled',
  'order.refunded',
  'cart.abandoned',
] as const;

export const PAYMENT_EVENTS = [
  'payment.captured',
  'payment.failed',
  'payment.refunded',
] as const;

export const SHIPMENT_EVENTS = [
  'shipment.created',
  'shipment.in_transit',
  'shipment.delivered',
  'shipment.failed',
] as const;

export type OrderEvent = (typeof ORDER_EVENTS)[number];
export type PaymentEvent = (typeof PAYMENT_EVENTS)[number];
export type ShipmentEvent = (typeof SHIPMENT_EVENTS)[number];

export const NOTIFICATION_EVENTS = [
  ...ORDER_EVENTS,
  ...PAYMENT_EVENTS,
  ...SHIPMENT_EVENTS,
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export function isOrderEvent(value: unknown): value is OrderEvent {
  return (
    typeof value === 'string' &&
    (ORDER_EVENTS as readonly string[]).includes(value)
  );
}

export function isShipmentEvent(value: unknown): value is ShipmentEvent {
  return (
    typeof value === 'string' &&
    (SHIPMENT_EVENTS as readonly string[]).includes(value)
  );
}

export function isNotificationEvent(
  value: unknown
): value is NotificationEvent {
  return (
    typeof value === 'string' &&
    (NOTIFICATION_EVENTS as readonly string[]).includes(value)
  );
}
