// ============================================================
// Meta Marketing API client — the ads-side counterpart to
// lib/whatsapp/meta-api.ts.
//
// Phase 1 (verifyAdAccount, Custom Audiences) uses long-stable,
// well-documented Marketing API surfaces with high confidence.
//
// Phase 2 (createCampaign/createAdSet/createAdCreative/createAd) was
// reverse-engineered against a REAL Click-to-WhatsApp ad this
// account already had running in its own Ads Manager, read back via
// the Graph API — not guessed from possibly-stale training data. The
// campaign objective (OUTCOME_ENGAGEMENT), ad set's optimization_goal
// (CONVERSATIONS)/billing_event (IMPRESSIONS)/destination_type
// (WHATSAPP)/promoted_object shape are all ground-truth confirmed
// this way. The one field that ISN'T independently confirmed is the
// ad creative's `call_to_action.type` value (WHATSAPP_MESSAGE) — that
// specific ad was built via Meta's own "auto-generated post" shortcut,
// which doesn't expose an inspectable link_data/call_to_action, so
// this uses the long-documented classic explicit format instead. To
// keep a wrong guess here harmless, every object this client creates
// is launched PAUSED (see lib/meta-ads/launch.ts) — worst case is a
// creative that fails validation or a paused ad that needs a manual
// fix in Ads Manager, never unintended spend.
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

/** `123456` and `act_123456` both resolve to the same Graph API path segment. */
function adAccountPath(adAccountId: string): string {
  return adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`
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
  const id = adAccountPath(adAccountId)
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
  const id = adAccountPath(adAccountId)
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

export interface MetaPage {
  id: string
  name: string
}

/** Facebook Pages this token can act as — a Click-to-WhatsApp ad's destination is tied to a Page (see module comment), not a phone number field. */
export async function listPages(accessToken: string): Promise<MetaPage[]> {
  const response = await fetch(`${META_API_BASE}/me/accounts?fields=id,name&limit=200`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { data?: MetaPage[] }
  return data.data ?? []
}

/**
 * Fetches the image at `imageUrl` server-side and uploads its bytes
 * to Meta, returning the `image_hash` an ad creative's `link_data`
 * references. Meta's adimages response shape (`{images: {<key>:
 * {hash}}}`) is long-stable — confirmed in Meta's own Marketing API
 * docs, not part of the reverse-engineered Phase 2 surface.
 */
export async function uploadAdImageFromUrl(args: {
  accessToken: string
  adAccountId: string
  imageUrl: string
}): Promise<{ hash: string }> {
  const { accessToken, adAccountId, imageUrl } = args
  const id = adAccountPath(adAccountId)

  const imageResponse = await fetch(imageUrl)
  if (!imageResponse.ok) {
    throw new Error(`Could not fetch the ad image from ${imageUrl}`)
  }
  const bytes = Buffer.from(await imageResponse.arrayBuffer()).toString('base64')

  const response = await fetch(`${META_API_BASE}/${id}/adimages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bytes }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { images?: Record<string, { hash?: string }> }
  const first = Object.values(data.images ?? {})[0]
  if (!first?.hash) {
    throw new Error('Meta did not return an image hash for the uploaded image')
  }
  return { hash: first.hash }
}

/** Always created PAUSED — see module comment. */
export async function createCampaign(args: {
  accessToken: string
  adAccountId: string
  name: string
}): Promise<{ id: string }> {
  const { accessToken, adAccountId, name } = args
  const id = adAccountPath(adAccountId)
  const response = await fetch(`${META_API_BASE}/${id}/campaigns`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      objective: 'OUTCOME_ENGAGEMENT',
      status: 'PAUSED',
      special_ad_categories: [],
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

/**
 * Ad set fields (optimization_goal/billing_event/destination_type/
 * promoted_object) are ground-truth confirmed — see module comment.
 * `countryCode` defaults to India (this integration's confirmed
 * currency/market) since Meta's targeting object requires
 * geo_locations regardless of whether a Custom Audience narrows it
 * further.
 */
export async function createAdSet(args: {
  accessToken: string
  adAccountId: string
  campaignId: string
  name: string
  pageId: string
  dailyBudgetMajorUnits: number
  customAudienceId?: string
  countryCode?: string
}): Promise<{ id: string }> {
  const { accessToken, adAccountId, campaignId, name, pageId, dailyBudgetMajorUnits, customAudienceId, countryCode = 'IN' } = args
  const id = adAccountPath(adAccountId)

  const targeting: Record<string, unknown> = {
    geo_locations: { countries: [countryCode] },
  }
  if (customAudienceId) {
    targeting.custom_audiences = [{ id: customAudienceId }]
  }

  const response = await fetch(`${META_API_BASE}/${id}/adsets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      campaign_id: campaignId,
      optimization_goal: 'CONVERSATIONS',
      billing_event: 'IMPRESSIONS',
      destination_type: 'WHATSAPP',
      promoted_object: { page_id: pageId },
      targeting,
      // Meta's daily_budget is in the account currency's minor unit (paise for INR).
      daily_budget: Math.round(dailyBudgetMajorUnits * 100),
      status: 'PAUSED',
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

/**
 * The one field in this module that is NOT independently ground-truth
 * confirmed — `call_to_action.type: 'WHATSAPP_MESSAGE'` — see module
 * comment for why, and why that's an acceptable risk (everything this
 * client creates stays PAUSED until a human reviews and activates it).
 */
export async function createAdCreative(args: {
  accessToken: string
  adAccountId: string
  name: string
  pageId: string
  message: string
  imageHash?: string
}): Promise<{ id: string }> {
  const { accessToken, adAccountId, name, pageId, message, imageHash } = args
  const id = adAccountPath(adAccountId)

  const linkData: Record<string, unknown> = {
    message,
    call_to_action: { type: 'WHATSAPP_MESSAGE' },
  }
  if (imageHash) linkData.image_hash = imageHash

  const response = await fetch(`${META_API_BASE}/${id}/adcreatives`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      object_story_spec: { page_id: pageId, link_data: linkData },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

/** Always created PAUSED — see module comment. */
export async function createAd(args: {
  accessToken: string
  adAccountId: string
  adsetId: string
  creativeId: string
  name: string
}): Promise<{ id: string }> {
  const { accessToken, adAccountId, adsetId, creativeId, name } = args
  const id = adAccountPath(adAccountId)
  const response = await fetch(`${META_API_BASE}/${id}/ads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      adset_id: adsetId,
      creative: { creative_id: creativeId },
      status: 'PAUSED',
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}
