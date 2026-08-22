// ============================================================
// Pluggable payment-gateway interface — selected by
// `payment_gateway_configs.gateway`. Razorpay ships first; a second
// gateway (e.g. Stripe) is a new module implementing this interface
// plus one entry in `PAYMENT_GATEWAYS` (rules.ts's CHECK constraint
// in migration 067 also needs extending — a new gateway IS a
// migration, unlike a new notification event, since the verifier is a
// hardcoded code branch, not data).
// ============================================================

import type { NotificationEvent } from '@/lib/notifications/events';

/** A gateway's raw webhook payload, normalized into wacrm's shape. */
export interface ParsedGatewayEvent {
  /** One of the `payment.*` NOTIFICATION_EVENTS, or null to ignore silently (e.g. an event type wacrm doesn't act on). */
  event: NotificationEvent | null;
  /** Recipient phone number in whatever format the gateway sent it, or null if the payload carries none. */
  phone: string | null;
  /** Flattened fields for `notification_rules.param_mapping` dot-paths to read from. */
  data: Record<string, unknown>;
  /** The gateway's own event id, if it has one — used as the idempotency key so a retried delivery doesn't double-send. */
  eventId: string | null;
}

export interface PaymentGatewayAdapter {
  /** Verify the inbound delivery's signature against the account's decrypted webhook secret. Fail-closed: false on any doubt. */
  verifySignature(rawBody: string, headers: Headers, secret: string): boolean;
  /** Parse+normalize the raw body. Returns null only for a payload that's structurally unparseable (not merely an event type we ignore — that's `event: null` above). */
  parseEvent(rawBody: string): ParsedGatewayEvent | null;
}

export const PAYMENT_GATEWAYS = ['razorpay'] as const;
export type PaymentGateway = (typeof PAYMENT_GATEWAYS)[number];

export function isPaymentGateway(value: unknown): value is PaymentGateway {
  return (
    typeof value === 'string' &&
    (PAYMENT_GATEWAYS as readonly string[]).includes(value)
  );
}
