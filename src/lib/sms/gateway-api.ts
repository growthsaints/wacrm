// ============================================================
// HTTP client for the "SMS Gateway for Android" device/private-server
// API (https://github.com/capcom6/android-sms-gateway). Talks to
// whatever `baseUrl` the account configured — the device's local
// server, a private server, or the vendor's cloud relay all expose the
// same `/message`(s)-shaped API, per the project's swagger.json.
// ============================================================

export class GatewayApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'GatewayApiError'
    this.status = status
  }
}

export interface GatewayCredentials {
  baseUrl: string
  username: string
  password: string
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function authHeader(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
}

/**
 * Enqueue a text SMS. Mirrors the gateway's `POST /messages` (local
 * server) / `POST /3rdparty/v1/message` (cloud) request shape:
 * `{ id?, phoneNumbers: string[], textMessage: { text } }`.
 *
 * `id` (optional) makes the send idempotent on the gateway side — pass
 * our own `messages.id` so a retried send can't double-dispatch.
 */
export async function sendSms(
  creds: GatewayCredentials,
  params: { id?: string; phoneNumbers: string[]; text: string },
): Promise<{ id: string; state: string }> {
  const url = `${normalizeBaseUrl(creds.baseUrl)}/message`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(creds.username, creds.password),
      },
      body: JSON.stringify({
        id: params.id,
        phoneNumbers: params.phoneNumbers,
        textMessage: { text: params.text },
      }),
    })
  } catch (err) {
    throw new GatewayApiError(
      `Could not reach SMS gateway at ${creds.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      502,
    )
  }

  const body = await res.json().catch(() => null)

  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'message' in body && String(body.message)) ||
      `SMS gateway returned ${res.status}`
    throw new GatewayApiError(message, res.status)
  }

  if (!body || typeof body !== 'object' || !('id' in body)) {
    throw new GatewayApiError('SMS gateway returned an unexpected response shape', 502)
  }

  return {
    id: String((body as { id: unknown }).id),
    state: 'state' in body ? String((body as { state: unknown }).state) : 'Pending',
  }
}

/**
 * Check that `baseUrl`/`username`/`password` actually reach a gateway —
 * used by the settings page's "Test Connection" button and by the save
 * route before persisting credentials. `/health` requires no auth on
 * the gateway side, but we still probe with Basic Auth via `/device`
 * (the local API's device-list endpoint) so a wrong username/password
 * is caught here rather than on the first real send.
 */
export async function verifyGatewayConnection(creds: GatewayCredentials): Promise<void> {
  const url = `${normalizeBaseUrl(creds.baseUrl)}/device`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: authHeader(creds.username, creds.password) },
    })
  } catch (err) {
    throw new GatewayApiError(
      `Could not reach SMS gateway at ${creds.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      502,
    )
  }

  if (res.status === 401 || res.status === 403) {
    throw new GatewayApiError('SMS gateway rejected the username/password', res.status)
  }
  if (!res.ok) {
    throw new GatewayApiError(`SMS gateway returned ${res.status}`, res.status)
  }
}
