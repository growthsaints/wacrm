import crypto from 'node:crypto'

/**
 * Verify the HS256 JWT Bearer token httpSMS attaches to every webhook
 * POST's `Authorization` header, signed with the `signing_key` we
 * registered the webhook with (docs.httpsms.com/webhooks/introduction).
 * Standard compact JWT: base64url(header).base64url(payload).signature,
 * where signature = HMAC-SHA256(header + "." + payload, secret). We
 * only need to prove the request was signed with our secret — there's
 * no documented claim (exp/iat) to additionally validate, and unlike
 * the SMS Gateway integration's body+timestamp HMAC, the JWT itself
 * carries no body-binding to check.
 */
export function verifyHttpSmsWebhookAuth(authHeader: string | null, secret: string): boolean {
  if (!authHeader) return false
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim())
  if (!match) return false

  const parts = match[1].split('.')
  if (parts.length !== 3) return false
  const [headerB64, payloadB64, signatureB64] = parts

  let header: { alg?: string }
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'))
  } catch {
    return false
  }
  if (header.alg !== 'HS256') return false

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url')

  const a = Buffer.from(signatureB64)
  const b = Buffer.from(expectedSignature)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
