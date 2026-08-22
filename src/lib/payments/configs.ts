// ============================================================
// payment_gateway_configs (migration 067) — API serialization. The
// `webhook_secret` is never returned once encrypted; it's shown in
// plaintext only in the create request the caller sent (they typed
// it in from their gateway's dashboard — we never generate it).
// ============================================================

import type { PaymentGateway } from './gateway';

/** Columns safe to return over the API — everything except the encrypted secret. */
export const PAYMENT_GATEWAY_CONFIG_COLUMNS =
  'id, gateway, is_active, created_at';

export interface ApiPaymentGatewayConfig {
  id: string;
  gateway: PaymentGateway;
  is_active: boolean;
  created_at: string;
  /** Paste this into the gateway's dashboard as the webhook target. */
  webhook_url: string;
}

/**
 * Project a `PAYMENT_GATEWAY_CONFIG_COLUMNS` row into the API shape,
 * computing `webhook_url` from the request's own origin so it's
 * correct behind whatever hostname the account actually deployed to.
 */
export function serializePaymentGatewayConfig(
  row: Record<string, unknown>,
  origin: string
): ApiPaymentGatewayConfig {
  return {
    id: row.id as string,
    gateway: row.gateway as PaymentGateway,
    is_active: Boolean(row.is_active),
    created_at: row.created_at as string,
    webhook_url: `${origin}/api/v1/payments/webhook/${row.id as string}`,
  };
}
