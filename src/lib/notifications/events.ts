// ============================================================
// Ecommerce Notification Integration — event vocabulary, pure/no I/O.
//
// Mirrors `lib/webhooks/events.ts`'s pattern: `notification_rules`
// (migration 066) stores `event` as a free `text` column, validated
// here in the app layer — adding an event is one entry in this file
// plus wiring it into the receiver that emits it, not a migration.
//
// Namespaced by receiver (`order.*` / `payment.*` / `shipment.*`) so
// the three receivers (Phase 2a/2b/2c) can't collide on event names.
// ============================================================

export const ECOMMERCE_EVENTS = [
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

export const SHIPPING_EVENTS = [
  'shipment.created',
  'shipment.in_transit',
  'shipment.out_for_delivery',
  'shipment.delivered',
  'shipment.failed',
  'shipment.returned',
] as const;

export const NOTIFICATION_EVENTS = [
  ...ECOMMERCE_EVENTS,
  ...PAYMENT_EVENTS,
  ...SHIPPING_EVENTS,
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** Type-narrow an unknown value into a valid `NotificationEvent`. */
export function isNotificationEvent(
  value: unknown
): value is NotificationEvent {
  return (
    typeof value === 'string' &&
    (NOTIFICATION_EVENTS as readonly string[]).includes(value)
  );
}
