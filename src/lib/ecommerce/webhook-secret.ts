// ============================================================
// Shared validation for a caller-supplied inbound-webhook secret —
// used by both payment_gateway_configs and shipping_configs, where
// (unlike webhook_endpoints) wacrm is the *receiver* and the secret
// must match one the caller configures on the other side.
// ============================================================

/** A short string is easy to brute-force; require real entropy. */
const MIN_SECRET_LENGTH = 16;

export function normalizeWebhookSecret(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  return trimmed.length >= MIN_SECRET_LENGTH ? trimmed : null;
}
