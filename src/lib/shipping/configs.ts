// ============================================================
// shipping_configs (migration 068) — API serialization. The
// `webhook_secret` is never returned once encrypted — it's shown in
// plaintext only in the create request the caller sent (you generate
// it and put it in whatever signs your outbound calls to wacrm).
// ============================================================

/** Columns safe to return over the API — everything except the encrypted secret. */
export const SHIPPING_CONFIG_COLUMNS = 'id, carrier, is_active, created_at';

export interface ApiShippingConfig {
  id: string;
  carrier: string;
  is_active: boolean;
  created_at: string;
  /** Target for your shipping system's signed calls to wacrm. */
  webhook_url: string;
}

/**
 * Project a `SHIPPING_CONFIG_COLUMNS` row into the API shape,
 * computing `webhook_url` from the request's own origin.
 */
export function serializeShippingConfig(
  row: Record<string, unknown>,
  origin: string
): ApiShippingConfig {
  return {
    id: row.id as string,
    carrier: row.carrier as string,
    is_active: Boolean(row.is_active),
    created_at: row.created_at as string,
    webhook_url: `${origin}/api/v1/shipping/webhook/${row.id as string}`,
  };
}
