// ============================================================
// Meta Marketing API client — the ads-side counterpart to
// lib/whatsapp/meta-api.ts. Deliberately scoped to what's needed for
// Phase 1 (connect an ad account, build/sync a Custom Audience from
// CRM contacts): both are long-stable, well-documented Marketing API
// surfaces. Campaign/AdSet/Ad creation (actually launching a
// Click-to-WhatsApp ad) is intentionally NOT implemented here yet —
// that part of Meta's schema couldn't be confirmed against current
// docs from this environment, and guessing it risks real ad spend.
// ============================================================

import { createHash } from 'node:crypto'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

const META_API_BASE = 'https://graph.facebook.com/v21.0'

interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string; error_subcode?: number }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) message = data.error.message
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

export interface MetaAdAccountInfo {
  id: string
  name: string
  account_status: number
  currency: string
}

/** account_status === 1 is Meta's "ACTIVE" value; anything else means paused/disabled/under review. */
export const AD_ACCOUNT_ACTIVE_STATUS = 1

/**
 * Verifies a System User access token can actually read the given ad
 * account (act_<id>) — the same "does a basic read succeed" trust
 * pattern used elsewhere in this codebase (see
 * lib/whatsapp/account-alert-recheck.ts) rather than trusting
 * whatever the admin typed in without checking.
 */
export async function verifyAdAccount(args: {
  accessToken: string
  adAccountId: string
}): Promise<MetaAdAccountInfo> {
  const { accessToken, adAccountId } = args
  const id = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`
  const url = `${META_API_BASE}/${id}?fields=id,name,account_status,currency`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

/**
 * Meta's required normalization for a PHONE-schema Custom Audience
 * match key: digits only (country code included, no leading '+' or
 * delimiters), then SHA-256 hex digest. `normalizePhone` already
 * strips everything to digits-only — the same helper the rest of the
 * app uses for phone comparison/dedup — so this is just the hashing
 * step on top of it.
 */
export function hashPhoneForCustomAudience(phone: string): string {
  const digits = normalizePhone(phone)
  return createHash('sha256').update(digits).digest('hex')
}

export interface CreateCustomAudienceResult {
  id: string
}

/** Creates an empty Custom Audience shell — addPhonesToCustomAudience populates it. */
export async function createCustomAudience(args: {
  accessToken: string
  adAccountId: string
  name: string
}): Promise<CreateCustomAudienceResult> {
  const { accessToken, adAccountId, name } = args
  const id = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`
  const response = await fetch(`${META_API_BASE}/${id}/customaudiences`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      subtype: 'CUSTOM',
      customer_file_source: 'USER_PROVIDED_ONLY',
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

/**
 * Uploads a batch of already-hashed phone numbers (see
 * hashPhoneForCustomAudience) to an existing Custom Audience. Meta
 * caps a single request at 10,000 rows — callers batch larger
 * segments themselves.
 */
export async function addPhonesToCustomAudience(args: {
  accessToken: string
  metaAudienceId: string
  hashedPhones: string[]
}): Promise<void> {
  const { accessToken, metaAudienceId, hashedPhones } = args
  if (hashedPhones.length === 0) return
  const response = await fetch(`${META_API_BASE}/${metaAudienceId}/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payload: {
        schema: ['PHONE'],
        data: hashedPhones.map((h) => [h]),
      },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}
