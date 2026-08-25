// ============================================================
// payment_gateway_configs store helpers.
// ============================================================

export const PAYMENT_GATEWAYS = ['razorpay'] as const;
export type PaymentGateway = (typeof PAYMENT_GATEWAYS)[number];

export function isPaymentGateway(value: unknown): value is PaymentGateway {
  return (
    typeof value === 'string' &&
    (PAYMENT_GATEWAYS as readonly string[]).includes(value)
  );
}

export { normalizeWebhookSecret } from './webhook-secret';

export interface ApiPaymentGatewayConfig {
  id: string;
  gateway: PaymentGateway;
  webhook_url: string;
  created_at: string;
}

export function serializePaymentGatewayConfig(
  row: { id: string; gateway: string; created_at: string },
  baseUrl: string
): ApiPaymentGatewayConfig {
  return {
    id: row.id,
    gateway: row.gateway as PaymentGateway,
    webhook_url: `${baseUrl}/api/webhooks/razorpay/${row.id}`,
    created_at: row.created_at,
  };
}
