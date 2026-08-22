// ============================================================
// shipping_configs store helpers.
//
// No dominant courier API exists, so this is a generic receiver: the
// operator's own backend (or whatever bridges their courier) POSTs
// here, signed with wacrm's own outbound scheme
// (X-Wacrm-Signature: t=…,v1=…, see src/lib/webhooks/sign.ts) reused
// in the *inbound* direction — the caller signs with the secret they
// chose at config-creation time, and wacrm verifies it the same way a
// receiver of wacrm's own outbound webhooks would.
// ============================================================

export { normalizeWebhookSecret } from './webhook-secret';

export function normalizeCarrier(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface ApiShippingConfig {
  id: string;
  carrier: string;
  webhook_url: string;
  created_at: string;
}

export function serializeShippingConfig(
  row: { id: string; carrier: string; created_at: string },
  baseUrl: string
): ApiShippingConfig {
  return {
    id: row.id,
    carrier: row.carrier,
    webhook_url: `${baseUrl}/api/webhooks/shipping/${row.id}`,
    created_at: row.created_at,
  };
}
