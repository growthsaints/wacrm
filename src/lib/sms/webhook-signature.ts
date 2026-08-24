import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature the SMS Gateway Android app attaches
 * to webhook POSTs (its `PayloadSingingPlugin`): `X-Signature: <hex>`
 * over `body + timestamp`, with the timestamp (unix seconds) echoed in
 * `X-Timestamp`.
 *
 * Unlike Meta's webhook, the gateway itself doesn't enforce a replay
 * window on the timestamp it signs — it's just folded into the message
 * to stop signature reuse across different bodies. We additionally
 * reject requests whose timestamp is more than `maxSkewSeconds` from
 * now, so a captured request can't be replayed indefinitely.
 */
export function verifySmsWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  secret: string,
  maxSkewSeconds = 5 * 60,
): boolean {
  if (!signatureHeader || !timestampHeader) return false
  if (!/^\d+$/.test(timestampHeader)) return false

  const timestamp = Number(timestampHeader)
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - timestamp) > maxSkewSeconds) return false

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody + timestampHeader)
    .digest('hex')

  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
