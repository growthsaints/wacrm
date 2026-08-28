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
      // Budget lives on the ad set (see createAdSet), not the campaign, so
      // Meta requires this to be explicit — (#4834011) "Must specify True
      // or False in is_adset_budget_sharing_enabled field" otherwise.
      is_adset_budget_sharing_enabled: false,
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
 *
 * Placements are pinned to Facebook only rather than left on Meta's
 * "Advantage+ / automatic placements" default, which pulls in
 * Instagram — and fails outright ((#1815199) "Ad account does not
 * have access to Instagram account") for any ad account with no
 * Instagram account authorized. Facebook-only sidesteps that
 * requirement entirely; it doesn't affect where the resulting chat
 * lands (that's destination_type/promoted_object above, not
 * placements — placements only control where the ad itself is shown).
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
    publisher_platforms: ['facebook'],
    // Advantage+ audience would let Meta expand delivery beyond what's
    // targeted below — explicitly disabled so a selected Custom Audience
    // (or the plain geo targeting) is respected as-is, not broadened.
    targeting_automation: { advantage_audience: 0 },
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
      // Budget lives on this ad set (see createCampaign), so Meta requires
      // an explicit bid strategy — (#2490487) otherwise. LOWEST_COST_WITHOUT_CAP
      // is Meta's "highest volume" default and needs no bid amount.
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
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
    // `link` is required by link_data even for a WhatsApp-destination ad
    // (#2061015) — the actual click destination is controlled by the ad
    // set's destination_type/promoted_object, not this URL, so a fixed
    // wa.me placeholder satisfies the schema without doing anything.
    link: 'https://wa.me/',
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

/**
 * Turns a launched campaign on or off — this is the "Activate" /
 * "Pause" button in wacrm's own UI, so it never has to send someone
 * back out to Ads Manager just to flip delivery on. Meta requires the
 * campaign, ad set, AND ad to all be ACTIVE for delivery to actually
 * happen, so activating sets status on all three; pausing only needs
 * one, but all three are set for symmetry (so the objects agree with
 * each other if inspected individually in Ads Manager).
 */
export async function setCampaignDeliveryStatus(args: {
  accessToken: string
  campaignId: string
  adSetId: string
  adId: string
  status: 'ACTIVE' | 'PAUSED'
}): Promise<void> {
  const { accessToken, campaignId, adSetId, adId, status } = args
  for (const objectId of [campaignId, adSetId, adId]) {
    const response = await fetch(`${META_API_BASE}/${objectId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!response.ok) {
      await throwMetaError(response, `Meta API error: ${response.status}`)
    }
  }
}

export interface MetaCampaignInsights {
  spend: number
  reach: number
  impressions: number
  clicks: number
}

/**
 * Lifetime delivery stats for a campaign — the numbers wacrm's own
 * dashboard shows instead of sending an admin back to Ads Manager to
 * check reach/spend. `spend`/`reach`/`impressions`/`clicks` are
 * long-stable, universally-documented Insights fields (unlike the
 * exact `actions` action_type key for "conversations started", which
 * this deliberately doesn't parse — no real delivery data existed
 * yet to ground-truth verify that key against, and guessing it wrong
 * would silently show a $0/0 metric that looks like a real answer).
 * Meta returns an empty `data` array (not an error) for a campaign
 * with no delivery yet — treated as all-zero stats, not a failure.
 */
export async function getCampaignInsights(args: {
  accessToken: string
  campaignId: string
}): Promise<MetaCampaignInsights> {
  const { accessToken, campaignId } = args
  const url = new URL(`${META_API_BASE}/${campaignId}/insights`)
  url.searchParams.set('fields', 'spend,reach,impressions,clicks')
  url.searchParams.set('date_preset', 'maximum')
  const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as {
    data?: Array<{ spend?: string; reach?: string; impressions?: string; clicks?: string }>
  }
  const row = data.data?.[0]
  return {
    spend: Number(row?.spend ?? 0),
    reach: Number(row?.reach ?? 0),
    impressions: Number(row?.impressions ?? 0),
    clicks: Number(row?.clicks ?? 0),
  }
}

// ============================================================
// Video and Carousel formats — ground-truth confirmed against real
// objects built in this account's own Ads Manager (a manually-created
// video ad and carousel ad), the same process used for the original
// image-format work above. See migration 090's header comment for the
// full verification notes.
// ============================================================

/**
 * Uploads a video to Meta from a URL wacrm already hosts — Meta fetches
 * it server-side (`file_url`), so there's no need to download/re-upload
 * bytes ourselves the way `uploadAdImageFromUrl` has to for images
 * (which have no such endpoint). Processing is asynchronous; the
 * returned id isn't usable in a creative until `getVideoStatus` reports
 * `ready` (see that function's comment).
 *
 * This POST uses form-encoding (`URLSearchParams`), not JSON — that's
 * what the ground-truth curl test against this exact endpoint used
 * successfully; unlike every other endpoint in this module, `/advideos`
 * wasn't verified to also accept a JSON body.
 */
export async function uploadAdVideoFromUrl(args: {
  accessToken: string
  adAccountId: string
  videoUrl: string
  title: string
}): Promise<{ videoId: string }> {
  const { accessToken, adAccountId, videoUrl, title } = args
  const id = adAccountPath(adAccountId)
  const body = new URLSearchParams({ file_url: videoUrl, title })
  const response = await fetch(`${META_API_BASE}/${id}/advideos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body,
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { id: string }
  return { videoId: data.id }
}

export interface VideoStatus {
  ready: boolean
  /** Meta auto-generates a thumbnail once processing completes — used
   *  as the creative's required `image_url` without wacrm needing its
   *  own thumbnail-extraction step. Null until ready. */
  thumbnailUrl: string | null
}

/** Polls this once — callers loop (see lib/meta-ads/launch.ts) since processing takes anywhere from a few seconds to a couple of minutes depending on video length/size. */
export async function getVideoStatus(args: { accessToken: string; videoId: string }): Promise<VideoStatus> {
  const { accessToken, videoId } = args
  const url = new URL(`${META_API_BASE}/${videoId}`)
  url.searchParams.set('fields', 'status,picture')
  const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { status?: { video_status?: string }; picture?: string }
  return {
    ready: data.status?.video_status === 'ready',
    thumbnailUrl: data.picture ?? null,
  }
}

/** Classic object_story_spec.video_data — see module comment for ground-truth verification notes. Always PAUSED via createAd, same as the image/carousel paths. */
export async function createVideoAdCreative(args: {
  accessToken: string
  adAccountId: string
  name: string
  pageId: string
  videoId: string
  thumbnailUrl: string
  message: string
}): Promise<{ id: string }> {
  const { accessToken, adAccountId, name, pageId, videoId, thumbnailUrl, message } = args
  const id = adAccountPath(adAccountId)
  const response = await fetch(`${META_API_BASE}/${id}/adcreatives`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      object_story_spec: {
        page_id: pageId,
        video_data: {
          video_id: videoId,
          image_url: thumbnailUrl,
          message,
          call_to_action: { type: 'WHATSAPP_MESSAGE' },
        },
      },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

export interface CarouselCard {
  imageHash: string
  headline: string
  description?: string
}

/**
 * object_story_spec.link_data.child_attachments — confirmed to exactly
 * match a real carousel ad built directly in this account's Ads
 * Manager (see migration 090). Meta's own UI also sets a
 * `call_to_action` on each child individually (this does too, for
 * consistency) even though the top-level one already applies.
 */
export async function createCarouselAdCreative(args: {
  accessToken: string
  adAccountId: string
  name: string
  pageId: string
  message: string
  cards: CarouselCard[]
}): Promise<{ id: string }> {
  const { accessToken, adAccountId, name, pageId, message, cards } = args
  const id = adAccountPath(adAccountId)
  const response = await fetch(`${META_API_BASE}/${id}/adcreatives`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      object_story_spec: {
        page_id: pageId,
        link_data: {
          message,
          link: 'https://wa.me/',
          call_to_action: { type: 'WHATSAPP_MESSAGE' },
          child_attachments: cards.map((card) => ({
            link: 'https://wa.me/',
            image_hash: card.imageHash,
            name: card.headline,
            description: card.description ?? '',
            call_to_action: { type: 'WHATSAPP_MESSAGE' },
          })),
        },
      },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}
