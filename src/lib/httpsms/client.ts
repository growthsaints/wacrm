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
 * POST /messages/send — the one well-documented, high-confidence part
 * of httpSMS's API (confirmed via their swagger spec). `requestId` is
 * optional idempotency support on their side; we pass our own
 * `messages.id` so a retried send can't double-dispatch, mirroring the
 * Android Gateway integration's use of its own message id.
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

  if (!body || typeof body !== 'object' || !('id' in body)) {
    throw new HttpSmsApiError('httpSMS returned an unexpected response shape', 502)
  }

  return {
    id: String((body as { id: unknown }).id),
    status: 'status' in body ? String((body as { status: unknown }).status) : 'pending',
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
