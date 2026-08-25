// ============================================================
// HTTP client for the httpSMS cloud API (https://httpsms.com,
// https://github.com/NdoleStudio/httpsms). Unlike the Android SMS
// Gateway integration (lib/sms/gateway-api.ts), there's no self-hosted
// base_url — every account talks to the same api.httpsms.com, keyed
// by their own API key. httpSMS relays the send through whichever
// Android phone the account registered `from` on, in their own
// dashboard.
// ============================================================

const API_BASE = 'https://api.httpsms.com/v1'

export class HttpSmsApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'HttpSmsApiError'
    this.status = status
  }
}

async function httpSmsFetch(path: string, apiKey: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        ...init?.headers,
      },
    })
  } catch (err) {
    throw new HttpSmsApiError(
      `Could not reach httpSMS: ${err instanceof Error ? err.message : String(err)}`,
      502,
    )
  }
}

/**
 * POST /messages/send — confirmed against httpSMS's own docs
 * (docs.httpsms.com). `requestId` is their idempotency key AND doubles
 * as the correlation id status-change webhooks report back
 * (`data.request_id`) — we pass our own `messages.id` so both a
 * retried send can't double-dispatch and a later webhook can be
 * matched to the right row without relying only on `data.id`.
 *
 * The response body wraps the message entity under `data`
 * (`{ data: {...}, message: "...", status: "success" }`) — every
 * httpSMS endpoint uses this envelope, not just this one.
 */
export async function sendHttpSms(
  apiKey: string,
  params: { from: string; to: string; content: string; requestId?: string },
): Promise<{ id: string; status: string }> {
  const res = await httpSmsFetch('/messages/send', apiKey, {
    method: 'POST',
    body: JSON.stringify({
      from: params.from,
      to: params.to,
      content: params.content,
      request_id: params.requestId,
    }),
  })

  const body = await res.json().catch(() => null)

  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'message' in body && String(body.message)) ||
      `httpSMS returned ${res.status}`
    throw new HttpSmsApiError(message, res.status)
  }

  const data =
    body && typeof body === 'object' && 'data' in body && typeof body.data === 'object'
      ? (body.data as Record<string, unknown>)
      : null

  if (!data || !('id' in data)) {
    throw new HttpSmsApiError('httpSMS returned an unexpected response shape', 502)
  }

  return {
    id: String(data.id),
    status: 'status' in data ? String(data.status) : 'pending',
  }
}

/**
 * POST /webhooks — registers our webhook URL with httpSMS so
 * status-change and inbound-message events get pushed to
 * /api/httpsms/webhook/[token] automatically, no manual dashboard
 * paste required. `signingKey` is the same secret we store (encrypted)
 * as httpsms_config.webhook_secret — httpSMS signs each webhook POST's
 * Authorization header with it (HS256 JWT), which
 * lib/httpsms/webhook-signature.ts verifies on the way back in.
 *
 * Deliberately only the events this integration actually acts on —
 * phone.heartbeat.* and message.call.missed exist but have nothing to
 * do with SMS threading, so registering them would just mean silently
 * ignoring extra traffic on every webhook call.
 */
const HTTPSMS_WEBHOOK_EVENTS = [
  'message.phone.received',
  'message.phone.sent',
  'message.phone.delivered',
  'message.send.failed',
  'message.send.expired',
]

export async function registerHttpSmsWebhook(
  apiKey: string,
  params: { url: string; signingKey: string; phoneNumber: string },
): Promise<void> {
  const res = await httpSmsFetch('/webhooks', apiKey, {
    method: 'POST',
    body: JSON.stringify({
      url: params.url,
      signing_key: params.signingKey,
      events: HTTPSMS_WEBHOOK_EVENTS,
      phone_numbers: [params.phoneNumber],
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const message =
      (body && typeof body === 'object' && 'message' in body && String(body.message)) ||
      `httpSMS returned ${res.status}`
    throw new HttpSmsApiError(message, res.status)
  }
}

/**
 * Verify an API key is valid before persisting it — used by the
 * Settings "Connect" flow. httpSMS has no dedicated "whoami" endpoint
 * documented, so this probes the read-only GET /phones list: a valid
 * key returns 200, an invalid one 401/403.
 */
export async function verifyHttpSmsApiKey(apiKey: string): Promise<void> {
  const res = await httpSmsFetch('/phones', apiKey, { method: 'GET' })

  if (res.status === 401 || res.status === 403) {
    throw new HttpSmsApiError('httpSMS rejected this API key', res.status)
  }
  if (!res.ok) {
    throw new HttpSmsApiError(`httpSMS returned ${res.status}`, res.status)
  }
}
