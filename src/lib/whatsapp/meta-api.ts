/**
 * Meta WhatsApp Cloud API helpers.
 *
 * Every function takes a single options object (named parameters) instead
 * of positional arguments. This was a deliberate choice after the same
 * swapped-args bug was found four times in a row with the positional form
 * (e.g. `(accessToken, phoneNumberId)` vs `(phoneNumberId, accessToken)`).
 * With named params, a typo surfaces immediately as a TypeScript error
 * instead of a runtime rejection from Meta.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`
/**
 * Template Library is a newer Graph API surface than the rest of this
 * file targets — Meta's own docs example the browse/create calls
 * against v26.0, and v21.0 (this file's default) returns `(#100)
 * Tried accessing nonexisting field (message_template_library)`.
 * Scoped to just those two calls so every other Meta integration here
 * (sends, template submit, webhooks) stays pinned to the
 * already-verified v21.0.
 */
const META_API_BASE_LIBRARY = `https://graph.facebook.com/v26.0`

export interface MetaSendResult {
  messageId: string
}

export interface MetaPhoneInfo {
  id: string
  display_phone_number: string
  verified_name?: string
  quality_rating?: string
  /** Meta's phone-verification state — VERIFIED / NOT_VERIFIED / EXPIRED etc. */
  code_verification_status?: string
  /**
   * Business portfolio's messaging limit tier (e.g. TIER_250, TIER_2K,
   * TIER_10K, TIER_100K, TIER_UNLIMITED) — shared across every phone
   * number in the portfolio. This is `whatsapp_business_manager_messaging_limit`;
   * Meta's older `messaging_limit_tier` field name for the same
   * concept is deprecated (see Meta's Messaging Limits doc).
   */
  whatsapp_business_manager_messaging_limit?: string
}

interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string }
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

// ============================================================
// Phone number / account
// ============================================================

export interface VerifyPhoneNumberArgs {
  phoneNumberId: string
  accessToken: string
}

/**
 * Verify a Meta phone number ID by fetching its public metadata
 * (display_phone_number, verified_name, quality_rating).
 */
export async function verifyPhoneNumber(
  args: VerifyPhoneNumberArgs
): Promise<MetaPhoneInfo> {
  const { phoneNumberId, accessToken } = args
  const url = `${META_API_BASE}/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,whatsapp_business_manager_messaging_limit`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

// ============================================================
// Embedded Signup (official Meta onboarding)
// ============================================================
//
// The full flow (client-side FB.login() + postMessage handling lives
// in src/components/whatsapp/connect-whatsapp-button.tsx) hands the
// server a short-lived `code`. Two calls turn that into a fully
// configured, live number:
//
//   1. exchangeEmbeddedSignupCode — code → long-lived access token
//   2. getWabaDetails             — resolve a human-readable business
//                                    name to show in WhatsApp Management
//
// registerPhoneNumber / subscribeWabaToApp above are reused as-is —
// Embedded Signup calls the exact same Cloud API endpoints the manual
// flow already does, just with a token we minted instead of one the
// user pasted in.

export interface ExchangeEmbeddedSignupCodeArgs {
  appId: string
  appSecret: string
  code: string
}

export interface ExchangeEmbeddedSignupCodeResult {
  accessToken: string
  tokenType: string
  /** Seconds until expiry, when Meta returns one (long-lived tokens
   *  from this exchange are typically ~60 days; absent means it
   *  didn't specify one). */
  expiresIn?: number
}

/**
 * Exchange the short-lived authorization `code` from the Embedded
 * Signup popup for a long-lived access token.
 *
 * Errors surfaced verbatim so the completion route can distinguish
 * "code expired/already used" from other failures — the code is
 * single-use and only valid for a few minutes.
 */
export async function exchangeEmbeddedSignupCode(
  args: ExchangeEmbeddedSignupCodeArgs,
): Promise<ExchangeEmbeddedSignupCodeResult> {
  const { appId, appSecret, code } = args
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    code,
  })
  const response = await fetch(`${META_API_BASE}/oauth/access_token?${params.toString()}`)
  if (!response.ok) {
    await throwMetaError(response, `Meta token exchange failed: ${response.status}`)
  }
  const data = (await response.json()) as {
    access_token?: string
    token_type?: string
    expires_in?: number
  }
  if (!data.access_token) {
    throw new Error('Meta token exchange did not return an access token.')
  }
  return {
    accessToken: data.access_token,
    tokenType: data.token_type ?? 'bearer',
    expiresIn: data.expires_in,
  }
}

export interface GetWabaDetailsArgs {
  wabaId: string
  accessToken: string
}

export interface MetaWabaDetails {
  id: string
  name?: string
  message_template_namespace?: string
}

/**
 * Fetch the WhatsApp Business Account's own metadata — used as a
 * fallback "business name" when the Embedded Signup callback didn't
 * hand us a separate Business Manager id (see getBusinessDetails).
 */
export async function getWabaDetails(args: GetWabaDetailsArgs): Promise<MetaWabaDetails> {
  const { wabaId, accessToken } = args
  const url = `${META_API_BASE}/${wabaId}?fields=id,name,message_template_namespace`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

export interface GetBusinessDetailsArgs {
  businessId: string
  accessToken: string
}

export interface MetaBusinessDetails {
  id: string
  name?: string
}

/**
 * Fetch the Meta Business Manager entity's display name — the
 * friendliest "Business Name" for WhatsApp Management when the
 * Embedded Signup callback included a `business_id`. Falls back to
 * the WABA's own name (getWabaDetails) when this isn't available or
 * the token lacks `business_management` on this specific business.
 */
export async function getBusinessDetails(
  args: GetBusinessDetailsArgs,
): Promise<MetaBusinessDetails> {
  const { businessId, accessToken } = args
  const url = `${META_API_BASE}/${businessId}?fields=id,name`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

// ============================================================
// Business-wide WABA reconciliation (Super Admin only)
// ============================================================
//
// A cross-check against Meta's own records, using this deployment's
// Tech Provider System User token — separate from every tenant's own
// Embedded Signup access token. Answers "does what's in our DB still
// match what Meta thinks we have access to?", which our own DB can
// never answer on its own (e.g. a row edited/deleted directly in
// Supabase, or access revoked on Meta's side, would silently drift).

export interface MetaBusinessWabaSummary {
  id: string
  name?: string
  currency?: string
}

export interface FetchBusinessWabaAccountsArgs {
  businessId: string
  systemUserToken: string
}

async function fetchWabaEdge(
  businessId: string,
  systemUserToken: string,
  edge: 'owned_whatsapp_business_accounts' | 'client_whatsapp_business_accounts',
): Promise<MetaBusinessWabaSummary[]> {
  const url = `${META_API_BASE}/${businessId}/${edge}?fields=id,name,currency`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${systemUserToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta ${edge} fetch failed: ${response.status}`)
  }
  const data = (await response.json()) as { data?: MetaBusinessWabaSummary[] }
  return data.data ?? []
}

/**
 * Every WABA Meta currently shows as owned by, or shared with, this
 * deployment's own Business Manager — the ground truth to reconcile
 * our `whatsapp_config` rows against.
 */
export async function fetchBusinessWabaAccounts(
  args: FetchBusinessWabaAccountsArgs,
): Promise<{ owned: MetaBusinessWabaSummary[]; client: MetaBusinessWabaSummary[] }> {
  const { businessId, systemUserToken } = args
  const [owned, client] = await Promise.all([
    fetchWabaEdge(businessId, systemUserToken, 'owned_whatsapp_business_accounts'),
    fetchWabaEdge(businessId, systemUserToken, 'client_whatsapp_business_accounts'),
  ])
  return { owned, client }
}

// ============================================================
// Cloud API registration (subscription for inbound webhooks)
// ============================================================
//
// Saving a phone_number_id + access_token to whatsapp_config is NOT
// enough to receive inbound events from Meta. Two extra calls are
// required:
//
//   POST /{phone_number_id}/register
//     Subscribes the number for THIS app's webhook. Requires a
//     6-digit 2FA PIN the user previously set in Meta WhatsApp
//     Manager → Two-step verification. Without /register, inbound
//     events are routed to whichever app last claimed the number
//     (often the one that did Embedded Signup) — so a second user
//     adding a second number under the same WABA silently loses
//     every inbound message.
//
//   POST /{waba_id}/subscribed_apps
//     Subscribes the WABA itself to this app. Required exactly
//     once per WABA, but idempotent so calling on every save is
//     safe and cheap.
//
// Both calls are no-ops when already done — Meta returns success +
// the helpers below treat that as success.

export interface RegisterPhoneNumberArgs {
  phoneNumberId: string
  accessToken: string
  /**
   * 6-digit PIN the user set in Meta WhatsApp Manager →
   * Two-step verification. If 2FA is not enabled on the number,
   * Meta rejects /register with a clear error and the user is
   * pointed at the right setting in the UI.
   */
  pin: string
}

export interface RegisterPhoneNumberResult {
  success: boolean
  /**
   * True when Meta indicated the number was already registered to
   * THIS app — same outcome as a fresh registration from the
   * caller's POV, surfaced separately for logging clarity.
   */
  alreadyRegistered: boolean
}

/**
 * Register a phone number for inbound webhook events.
 *
 * Errors that should be surfaced verbatim to the user:
 *   * Missing / wrong PIN  → "Two-step verification PIN required..."
 *   * No 2FA enabled       → "Two-factor authentication is not on..."
 *   * Number on other app  → "Number is registered to another app..."
 */
export async function registerPhoneNumber(
  args: RegisterPhoneNumberArgs
): Promise<RegisterPhoneNumberResult> {
  const { phoneNumberId, accessToken, pin } = args
  const url = `${META_API_BASE}/${phoneNumberId}/register`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  })

  if (response.ok) {
    return { success: true, alreadyRegistered: false }
  }

  // Meta returns an error envelope with a code. Code 133005 + the
  // text "already registered" appears when the number is already
  // subscribed to this app — that's success from the caller's
  // perspective, surface it as such.
  let data: { error?: { message?: string; code?: number; error_subcode?: number } } = {}
  try {
    data = await response.json()
  } catch {
    /* keep empty */
  }
  const message = data.error?.message ?? `Meta API error: ${response.status}`
  if (/already.*registered/i.test(message)) {
    return { success: true, alreadyRegistered: true }
  }
  throw new Error(message)
}

export interface SubscribeWabaToAppArgs {
  wabaId: string
  accessToken: string
}

/**
 * Subscribe the WABA to this Meta app's webhook. Idempotent — Meta
 * returns success even when the subscription already exists.
 */
export async function subscribeWabaToApp(
  args: SubscribeWabaToAppArgs
): Promise<void> {
  const { wabaId, accessToken } = args
  const url = `${META_API_BASE}/${wabaId}/subscribed_apps`
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}

export interface GetSubscribedAppsArgs {
  wabaId: string
  accessToken: string
}

export interface SubscribedApp {
  whatsapp_business_api_data?: {
    id?: string
    name?: string
    link?: string
  }
}

/**
 * Diagnostic — fetch the list of apps currently subscribed to this
 * WABA. The UI uses this to confirm OUR app is in the list when
 * the user clicks Verify Registration.
 */
export async function getSubscribedApps(
  args: GetSubscribedAppsArgs
): Promise<SubscribedApp[]> {
  const { wabaId, accessToken } = args
  const url = `${META_API_BASE}/${wabaId}/subscribed_apps`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { data?: SubscribedApp[] }
  return data.data ?? []
}

// ============================================================
// Sending
// ============================================================

export interface SendTextMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  text: string
  /** Meta's message_id of the message being replied to. Adds a `context` field
   *  so WhatsApp renders the new message as a reply with a quote preview. */
  contextMessageId?: string
}

/**
 * Send a free-form WhatsApp text message.
 * Only works inside the 24-hour customer service window.
 */
export async function sendTextMessage(
  args: SendTextMessageArgs
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, text, contextMessageId } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export type MediaKind = 'image' | 'video' | 'document' | 'audio'

export interface SendMediaMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  kind: MediaKind
  /** Public URL Meta fetches at send time. */
  link: string
  /** Optional caption — Meta caps at 1024 chars. Documents + images + videos accept it; audio does NOT. */
  caption?: string
  /** Document-only. Shown in the recipient's chat as the file name. Ignored for image/video/audio. */
  filename?: string
  contextMessageId?: string
}

/**
 * Send an image, video, document, or audio (voice note) via a public URL.
 *
 * Used by the Flows engine's `send_media` node and the inbox composer's
 * agent-initiated media sends. Mirrors `sendTextMessage` — single fetch,
 * throws on non-2xx, returns Meta's message id.
 *
 * Audio is special-cased: Meta rejects `caption` and `filename` on audio
 * messages, so we send `{ link }` only. WhatsApp auto-renders an
 * OGG/Opus file as a playable voice note (waveform) rather than a file
 * attachment.
 */
export async function sendMediaMessage(
  args: SendMediaMessageArgs,
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, kind, link, caption, filename, contextMessageId } = args
  if (!link) throw new Error('sendMediaMessage requires a link.')
  const url = `${META_API_BASE}/${phoneNumberId}/messages`

  // Audio accepts neither caption nor filename per Meta's spec — adding
  // either yields a 400. image/video/document accept a caption; only
  // document accepts a filename.
  const media: Record<string, unknown> = { link }
  if (caption && kind !== 'audio') media.caption = caption
  if (kind === 'document' && filename) media.filename = filename

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: kind,
    [kind]: media,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

import type { MessageTemplate } from '@/types'
import {
  buildSendComponents,
  type SendTimeParams,
} from './template-send-builder'

export interface SendTemplateMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  templateName: string
  language?: string
  /**
   * Legacy body-only params. Kept for backward compat with callers
   * that haven't migrated to the structured `template` + `messageParams`
   * pair below. New callers should pass `template` so media headers
   * and URL buttons land on the send.
   */
  params?: string[]
  /**
   * The template row from message_templates. When provided, the helper
   * builds the full components array (header + body + buttons) via
   * buildSendComponents — that's the only way image/video/document
   * headers and URL-with-variable buttons actually reach the recipient.
   */
  template?: MessageTemplate
  /**
   * Structured per-send values. Body variables go in `body`; header
   * text variables in `headerText`; media overrides in
   * `headerMediaUrl` / `headerMediaId`; URL/COPY_CODE button values
   * in `buttonParams` keyed by index.
   */
  messageParams?: SendTimeParams
  /** Meta's message_id of the message being replied to. */
  contextMessageId?: string
}

/**
 * Send a pre-approved WhatsApp message template. Required outside
 * the 24-hour window and for any first-touch messaging.
 *
 * Caller paths:
 *   - Legacy: pass `params: string[]` (body only). Same behaviour as
 *     before this helper learned about media + buttons.
 *   - Structured: pass `template` (and optionally `messageParams`).
 *     The full components array is built from the row so media
 *     headers + URL buttons land correctly.
 */
export async function sendTemplateMessage(
  args: SendTemplateMessageArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId,
    accessToken,
    to,
    templateName,
    language = 'en_US',
    params,
    template,
    messageParams,
    contextMessageId,
  } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`

  const templatePayload: Record<string, unknown> = {
    name: templateName,
    language: { code: language },
  }

  if (template) {
    const components = buildSendComponents(template, {
      // Legacy callers pass body values in `params`; fold them into
      // `messageParams.body` so the new path covers them too.
      body: messageParams?.body ?? params,
      headerText: messageParams?.headerText,
      headerMediaUrl: messageParams?.headerMediaUrl,
      headerMediaId: messageParams?.headerMediaId,
      buttonParams: messageParams?.buttonParams,
      cards: messageParams?.cards,
    })
    if (components.length > 0) {
      templatePayload.components = components
    }
  } else if (params && params.length > 0) {
    // Legacy body-only path — no template row available.
    templatePayload.components = [
      {
        type: 'body',
        parameters: params.map((p) => ({ type: 'text', text: String(p) })),
      },
    ]
  }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: templatePayload,
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

// ============================================================
// Resumable Upload (media handles for template headers)
// ============================================================
//
// Creating a message template with a media HEADER (image/video/
// document) requires an `example.header_handle` — Meta does NOT accept
// a plain public URL at creation time. The handle comes from the
// two-step Resumable Upload API, which is keyed on the Meta APP id (not
// the phone number / WABA):
//
//   1. POST /{app_id}/uploads?file_name&file_length&file_type&access_token
//        → { id: "upload:<session>" }
//   2. POST /{id}  (Authorization: OAuth <token>, file_offset: 0, raw bytes)
//        → { h: "<handle>" }
//
// See https://developers.facebook.com/docs/graph-api/guides/upload

export interface UploadResumableMediaArgs {
  /** Meta App id (env META_APP_ID) — resumable upload is app-scoped. */
  appId: string
  accessToken: string
  fileName: string
  mimeType: string
  bytes: Uint8Array
}

/**
 * Upload a file via the Resumable Upload API and return the media
 * handle to use as `example.header_handle` when creating/editing a
 * template with a media header.
 */
export async function uploadResumableMedia(
  args: UploadResumableMediaArgs,
): Promise<{ handle: string }> {
  const { appId, accessToken, fileName, mimeType, bytes } = args

  // Step 1 — open an upload session.
  const startParams = new URLSearchParams({
    file_name: fileName,
    file_length: String(bytes.byteLength),
    file_type: mimeType,
    access_token: accessToken,
  })
  const startRes = await fetch(
    `${META_API_BASE}/${appId}/uploads?${startParams.toString()}`,
    { method: 'POST' },
  )
  if (!startRes.ok) {
    await throwMetaError(startRes, `Resumable upload start failed: ${startRes.status}`)
  }
  const startData = (await startRes.json()) as { id?: string }
  if (!startData.id) {
    throw new Error('Resumable upload did not return a session id.')
  }

  // Step 2 — upload the bytes. Note the `OAuth` auth scheme (not Bearer)
  // and the file_offset header, both required by this endpoint.
  const uploadRes = await fetch(`${META_API_BASE}/${startData.id}`, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${accessToken}`,
      file_offset: '0',
    },
    // Uint8Array is a valid BodyInit at runtime; cast around the
    // lib.dom ArrayBufferLike-vs-ArrayBuffer generic mismatch.
    body: bytes as unknown as BodyInit,
  })
  if (!uploadRes.ok) {
    await throwMetaError(uploadRes, `Resumable upload failed: ${uploadRes.status}`)
  }
  const uploadData = (await uploadRes.json()) as { h?: string }
  if (!uploadData.h) {
    throw new Error('Resumable upload did not return a file handle.')
  }
  return { handle: uploadData.h }
}

// ============================================================
// Template submission (Business Management API)
// ============================================================

import type { MetaTemplateSubmitPayload } from './template-components'

export interface SubmitMessageTemplateArgs {
  wabaId: string
  accessToken: string
  payload: MetaTemplateSubmitPayload
}

export interface SubmitMessageTemplateResult {
  id: string
  status: string
  category?: string
}

/**
 * Submit a message template to Meta for approval.
 *
 * Returns Meta's assigned template id + initial status (typically
 * PENDING). Caller persists `id` as `meta_template_id` so the
 * upcoming edit/delete flows can scope to this exact template (and
 * language variant) via `hsm_id`, rather than nuking every variant
 * with the same name.
 *
 * 429s from Meta (rate limit: 100 creates/hour/WABA) surface as a
 * regular `Error('Meta API error: 429')`. The route handler
 * distinguishes 429 and shows a more actionable toast.
 */
export async function submitMessageTemplate(
  args: SubmitMessageTemplateArgs
): Promise<SubmitMessageTemplateResult> {
  const { wabaId, accessToken, payload } = args
  const url = `${META_API_BASE}/${wabaId}/message_templates`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  if (!data?.id) {
    throw new Error('Meta accepted the template but returned no id.')
  }
  return {
    id: String(data.id),
    status: typeof data.status === 'string' ? data.status : 'PENDING',
    category: typeof data.category === 'string' ? data.category : undefined,
  }
}

// ============================================================
// Template Library — Meta's pre-approved template content
// (Utility/Authentication copy that skips manual App Review).
// Spec: "Template Library | Developer Documentation".
//
// Meta documents a dedicated browse/search endpoint
// (`GET /message_template_library`), but on real (non-demo) WABAs it
// returns an empty result set even for content confirmed to exist via
// WhatsApp Manager's own UI — verified against production after
// ruling out wrong-edge-name, wrong-API-version, and unquoted-search
// causes one at a time. So there's no browseTemplateLibrary() here —
// only the documented-and-working "create by exact name" call below.
// The UI has the user find the template's name in WhatsApp Manager
// first.
// ============================================================

export interface LibraryButtonInput {
  type:
    | 'QUICK_REPLY'
    | 'URL'
    | 'PHONE_NUMBER'
    | 'OTP'
    | 'MPM'
    | 'CATALOG'
    | 'FLOW'
    | 'VOICE_CALL'
    | 'APP'
  url?: { base_url: string; url_suffix_example?: string }
  phone_number?: string
  otp_type?: 'COPY_CODE' | 'ONE_TAP' | 'ZERO_TAP'
  zero_tap_terms_accepted?: boolean
  supported_apps?: { package_name: string; signature_hash: string }[]
}

export interface LibraryBodyInputs {
  add_contact_number?: boolean
  add_learn_more_link?: boolean
  add_security_recommendation?: boolean
  add_track_package_link?: boolean
  code_expiration_minutes?: number
}

export interface SubmitLibraryTemplateArgs {
  wabaId: string
  accessToken: string
  name: string
  category: MetaTemplateSubmitPayload['category']
  language: string
  libraryTemplateName: string
  buttonInputs?: LibraryButtonInput[]
  bodyInputs?: LibraryBodyInputs
}

/**
 * Create a template from Meta's Template Library. Same endpoint as a
 * from-scratch submission, but Meta supplies the header/body/footer
 * content — we only pass the library entry's name plus button/body
 * customization. Comes back APPROVED immediately (no review queue).
 *
 * `library_template_button_inputs` must be sent as a STRINGIFIED JSON
 * array, not a native nested array — Meta's documented request shape
 * for this one field is a string, unlike every other JSON body field.
 */
export async function submitLibraryTemplate(
  args: SubmitLibraryTemplateArgs,
): Promise<SubmitMessageTemplateResult> {
  const {
    wabaId,
    accessToken,
    name,
    category,
    language,
    libraryTemplateName,
    buttonInputs,
    bodyInputs,
  } = args
  const body: Record<string, unknown> = {
    name,
    category,
    language,
    library_template_name: libraryTemplateName,
  }
  if (buttonInputs && buttonInputs.length > 0) {
    body.library_template_button_inputs = JSON.stringify(buttonInputs)
  }
  if (bodyInputs && Object.keys(bodyInputs).length > 0) {
    body.library_template_body_inputs = bodyInputs
  }
  const url = `${META_API_BASE_LIBRARY}/${wabaId}/message_templates`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  if (!data?.id) {
    throw new Error('Meta accepted the library template but returned no id.')
  }
  return {
    id: String(data.id),
    status: typeof data.status === 'string' ? data.status : 'APPROVED',
    category: typeof data.category === 'string' ? data.category : undefined,
  }
}

export interface EditMessageTemplateArgs {
  /** Meta's template id (stored locally as `meta_template_id`). */
  metaTemplateId: string
  accessToken: string
  /** Send the full components array — Meta replaces, not patches. */
  components: MetaTemplateSubmitPayload['components']
  /** Optional — only certain category transitions are allowed by Meta. */
  category?: MetaTemplateSubmitPayload['category']
}

export interface EditMessageTemplateResult {
  success: boolean
}

/**
 * Edit an existing (APPROVED or REJECTED) message template.
 *
 * Meta caps edits at 10 per 30 days (and 1 per 24h for APPROVED
 * templates). Every edit re-triggers review, so the status flips
 * back to PENDING until Meta approves the new components.
 *
 * Note: PENDING / DISABLED / IN_APPEAL templates cannot be edited
 * — the route handler enforces that before calling here.
 */
export async function editMessageTemplate(
  args: EditMessageTemplateArgs
): Promise<EditMessageTemplateResult> {
  const { metaTemplateId, accessToken, components, category } = args
  const body: Record<string, unknown> = { components }
  if (category) body.category = category
  const response = await fetch(`${META_API_BASE}/${metaTemplateId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json().catch(() => ({}))
  return { success: data?.success !== false }
}

export interface DeleteMessageTemplateArgs {
  wabaId: string
  accessToken: string
  name: string
  /**
   * Without `hsm_id`, Meta deletes EVERY language variant of the
   * template with this `name`. Pass the row's `meta_template_id`
   * to scope to a single variant.
   */
  metaTemplateId?: string
}

/**
 * Delete a message template on Meta. Pass `metaTemplateId` to scope
 * to a single language variant — otherwise Meta nukes every variant
 * sharing the same `name`.
 */
export async function deleteMessageTemplate(
  args: DeleteMessageTemplateArgs
): Promise<void> {
  const { wabaId, accessToken, name, metaTemplateId } = args
  const params = new URLSearchParams({ name })
  if (metaTemplateId) params.set('hsm_id', metaTemplateId)
  const url = `${META_API_BASE}/${wabaId}/message_templates?${params.toString()}`
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  // Treat a 404 as a no-op — the template is already gone on Meta's
  // side, and we still want the local row removed.
  if (response.status === 404) return
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}

// ============================================================
// Reactions
// ============================================================

export interface SendReactionMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  /** Meta's message_id of the message being reacted to. */
  targetMessageId: string
  /** Single emoji, or empty string to remove an existing reaction. */
  emoji: string
}

/**
 * Send a reaction (or removal) to a previously-exchanged message.
 * Empty `emoji` removes the reaction per Meta's spec.
 */
export async function sendReactionMessage(
  args: SendReactionMessageArgs
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, targetMessageId, emoji } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: { message_id: targetMessageId, emoji },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

// ============================================================
// Interactive (button replies + list messages)
// ============================================================
//
// Meta's two flavours of interactive message — used by the Flows
// engine to drive scripted chatbot menus. Caller passes plain
// JS values; helpers shape the Meta payload and enforce Meta's
// limits BEFORE the network call so the failure mode is a
// developer-facing error rather than a customer-facing one.

/**
 * Meta limits for interactive messages, hard-coded so violations
 * fail at build/save time rather than as a 400 from the Meta API
 * mid-conversation. See:
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-reply-buttons-messages
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages
 */
export const INTERACTIVE_LIMITS = {
  maxButtons: 3,
  buttonTitleMaxLength: 20,
  maxListSections: 10,
  maxListRowsTotal: 10,
  listRowTitleMaxLength: 24,
  listRowDescriptionMaxLength: 72,
  bodyMaxLength: 1024,
  footerMaxLength: 60,
  headerTextMaxLength: 60,
} as const

export interface InteractiveButton {
  /** Stable id sent back in the webhook when tapped (≤ 256 chars). */
  id: string
  /** Visible label (≤ 20 chars per Meta). */
  title: string
}

export interface SendInteractiveButtonsArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  /** The body text — what the customer reads above the buttons. */
  bodyText: string
  /** Optional plain-text header (≤ 60 chars). */
  headerText?: string
  /** Optional grey footer line under the buttons (≤ 60 chars). */
  footerText?: string
  /** 1–3 buttons. Validated against Meta's limits before sending. */
  buttons: InteractiveButton[]
  /** Meta's message_id of the message being replied to (quote preview). */
  contextMessageId?: string
}

/**
 * Send an interactive message with up to 3 inline reply buttons. The
 * customer taps one and Meta delivers a webhook with
 * `messages[0].interactive.button_reply.id` set to the matching button.id.
 *
 * Validation throws BEFORE the network call so misconfigured flows
 * fail at save time, not during a live conversation.
 */
export async function sendInteractiveButtons(
  args: SendInteractiveButtonsArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId, accessToken, to,
    bodyText, headerText, footerText, buttons, contextMessageId,
  } = args
  validateInteractiveBody(bodyText)
  validateInteractiveHeaderFooter(headerText, footerText)
  if (buttons.length < 1 || buttons.length > INTERACTIVE_LIMITS.maxButtons) {
    throw new Error(
      `Interactive button message requires 1-${INTERACTIVE_LIMITS.maxButtons} buttons (got ${buttons.length}).`
    )
  }
  const seenButtonIds = new Set<string>()
  for (const btn of buttons) {
    if (!btn.id) throw new Error('Interactive button missing id.')
    // Duplicate button ids make the tapped-button webhook ambiguous —
    // Meta rejects them, and the pre-flight validator (interactive.ts)
    // rejects them too, so guard here to keep the two paths in step.
    if (seenButtonIds.has(btn.id)) {
      throw new Error(`Interactive message has duplicate button id "${btn.id}".`)
    }
    seenButtonIds.add(btn.id)
    if (!btn.title) throw new Error(`Interactive button "${btn.id}" missing title.`)
    if (btn.title.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
      throw new Error(
        `Interactive button title "${btn.title}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`
      )
    }
  }

  const interactive: Record<string, unknown> = {
    type: 'button',
    body: { text: bodyText },
    action: {
      buttons: buttons.map((b) => ({
        type: 'reply',
        reply: { id: b.id, title: b.title },
      })),
    },
  }
  if (headerText) interactive.header = { type: 'text', text: headerText }
  if (footerText) interactive.footer = { text: footerText }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export interface InteractiveListRow {
  /** Stable id sent back in the webhook when tapped (≤ 200 chars). */
  id: string
  /** Visible row title (≤ 24 chars per Meta). */
  title: string
  /** Optional secondary line shown under the title (≤ 72 chars). */
  description?: string
}

export interface InteractiveListSection {
  /** Optional section header shown above its rows. */
  title?: string
  rows: InteractiveListRow[]
}

export interface SendInteractiveListArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  bodyText: string
  /** Label of the tap-to-expand button on the message bubble. */
  buttonLabel: string
  headerText?: string
  footerText?: string
  /**
   * 1–10 rows TOTAL across all sections. Meta caps the *total*, not
   * per-section. Validation enforces this before send.
   */
  sections: InteractiveListSection[]
  contextMessageId?: string
}

/**
 * Send an interactive message with a tap-to-expand list of selectable
 * rows. Use when there are more options than the 3-button limit allows.
 * Webhook arrives with `messages[0].interactive.list_reply.id` set to
 * the matching row.id.
 */
export async function sendInteractiveList(
  args: SendInteractiveListArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId, accessToken, to,
    bodyText, buttonLabel, headerText, footerText, sections, contextMessageId,
  } = args
  validateInteractiveBody(bodyText)
  validateInteractiveHeaderFooter(headerText, footerText)
  if (!buttonLabel) throw new Error('Interactive list requires a buttonLabel.')
  if (buttonLabel.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
    throw new Error(
      `Interactive list buttonLabel "${buttonLabel}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`
    )
  }
  if (sections.length < 1 || sections.length > INTERACTIVE_LIMITS.maxListSections) {
    throw new Error(
      `Interactive list requires 1-${INTERACTIVE_LIMITS.maxListSections} sections (got ${sections.length}).`
    )
  }
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0)
  if (totalRows < 1 || totalRows > INTERACTIVE_LIMITS.maxListRowsTotal) {
    throw new Error(
      `Interactive list requires 1-${INTERACTIVE_LIMITS.maxListRowsTotal} rows total across all sections (got ${totalRows}).`
    )
  }
  const seenIds = new Set<string>()
  for (const section of sections) {
    for (const row of section.rows) {
      if (!row.id) throw new Error('Interactive list row missing id.')
      if (seenIds.has(row.id)) {
        throw new Error(`Interactive list has duplicate row id "${row.id}".`)
      }
      seenIds.add(row.id)
      if (!row.title) throw new Error(`Interactive list row "${row.id}" missing title.`)
      if (row.title.length > INTERACTIVE_LIMITS.listRowTitleMaxLength) {
        throw new Error(
          `Interactive list row title "${row.title}" exceeds ${INTERACTIVE_LIMITS.listRowTitleMaxLength} chars.`
        )
      }
      if (
        row.description &&
        row.description.length > INTERACTIVE_LIMITS.listRowDescriptionMaxLength
      ) {
        throw new Error(
          `Interactive list row description for "${row.id}" exceeds ${INTERACTIVE_LIMITS.listRowDescriptionMaxLength} chars.`
        )
      }
    }
  }

  const interactive: Record<string, unknown> = {
    type: 'list',
    body: { text: bodyText },
    action: {
      button: buttonLabel,
      sections: sections.map((s) => ({
        ...(s.title ? { title: s.title } : {}),
        rows: s.rows.map((r) => ({
          id: r.id,
          title: r.title,
          ...(r.description ? { description: r.description } : {}),
        })),
      })),
    },
  }
  if (headerText) interactive.header = { type: 'text', text: headerText }
  if (footerText) interactive.footer = { text: footerText }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

function validateInteractiveBody(bodyText: string): void {
  if (!bodyText) throw new Error('Interactive message requires bodyText.')
  if (bodyText.length > INTERACTIVE_LIMITS.bodyMaxLength) {
    throw new Error(
      `Interactive bodyText exceeds ${INTERACTIVE_LIMITS.bodyMaxLength} chars.`
    )
  }
}

function validateInteractiveHeaderFooter(
  headerText: string | undefined,
  footerText: string | undefined,
): void {
  if (headerText && headerText.length > INTERACTIVE_LIMITS.headerTextMaxLength) {
    throw new Error(
      `Interactive headerText exceeds ${INTERACTIVE_LIMITS.headerTextMaxLength} chars.`
    )
  }
  if (footerText && footerText.length > INTERACTIVE_LIMITS.footerMaxLength) {
    throw new Error(
      `Interactive footerText exceeds ${INTERACTIVE_LIMITS.footerMaxLength} chars.`
    )
  }
}

// ============================================================
// Media
// ============================================================

export interface GetMediaUrlArgs {
  mediaId: string
  accessToken: string
}

/**
 * Resolve a media ID to Meta's (short-lived, authenticated) CDN URL
 * plus the MIME type. Step one of the media-proxy flow.
 */
export async function getMediaUrl(
  args: GetMediaUrlArgs
): Promise<{ url: string; mimeType: string }> {
  const { mediaId, accessToken } = args
  const response = await fetch(`${META_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Media fetch failed: ${response.status}`)
  }
  const data = await response.json()
  if (!data.url) throw new Error('Media URL not found in Meta response')
  return { url: data.url, mimeType: data.mime_type || 'application/octet-stream' }
}

export interface DownloadMediaArgs {
  downloadUrl: string
  accessToken: string
}

/**
 * Fetch the binary bytes for a media URL obtained from getMediaUrl.
 * Step two of the media-proxy flow.
 */
export async function downloadMedia(
  args: DownloadMediaArgs
): Promise<{ buffer: Buffer; contentType: string }> {
  const { downloadUrl, accessToken } = args
  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new Error(`Media download failed: ${response.status}`)
  }
  const contentType =
    response.headers.get('content-type') || 'application/octet-stream'
  const buffer = Buffer.from(await response.arrayBuffer())
  return { buffer, contentType }
}

// ============================================================
// WhatsApp Flows — official Meta product (Milestone 4, Part 3).
// Docs: https://developers.facebook.com/docs/whatsapp/flows
// ============================================================

export interface SendInteractiveFlowArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  bodyText: string
  metaFlowId: string
  /** Per-send token Meta round-trips in the completion webhook
   *  payload — lets us attribute an `nfm_reply` back to the message
   *  that triggered it. */
  flowToken: string
  ctaLabel: string
  /** First screen id from the flow's JSON, when the flow has more
   *  than one entry point. Omit to use the flow's default. */
  screenId?: string
  screenData?: Record<string, unknown>
  contextMessageId?: string
}

export async function sendInteractiveFlow(
  args: SendInteractiveFlowArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId, accessToken, to, bodyText, metaFlowId,
    flowToken, ctaLabel, screenId, screenData, contextMessageId,
  } = args
  validateInteractiveBody(bodyText)
  if (!ctaLabel) throw new Error('Flow message requires a ctaLabel.')
  if (ctaLabel.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
    throw new Error(
      `Flow ctaLabel "${ctaLabel}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`
    )
  }

  const actionPayload: Record<string, unknown> = {}
  if (screenId) actionPayload.screen = screenId
  if (screenData) actionPayload.data = screenData

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'flow',
      body: { text: bodyText },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_token: flowToken,
          flow_id: metaFlowId,
          flow_cta: ctaLabel,
          flow_action: 'navigate',
          ...(Object.keys(actionPayload).length > 0
            ? { flow_action_payload: actionPayload }
            : {}),
        },
      },
    },
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export interface MetaFlowSummary {
  id: string
  name: string
  status: string
  categories?: string[]
  preview?: { preview_url: string; expires_at: string }
}

/**
 * Create a new Flow under the account's WhatsApp Business Account.
 * Returns the Meta-assigned flow id; the caller persists it onto the
 * local `whatsapp_flows` row.
 */
export async function createMetaFlow(args: {
  wabaId: string
  accessToken: string
  name: string
  categories: string[]
}): Promise<{ id: string }> {
  const url = `${META_API_BASE}/${args.wabaId}/flows`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({ name: args.name, categories: args.categories }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

/** Upload/replace a Flow's JSON definition (screens + routing). */
export async function updateMetaFlowJson(args: {
  flowId: string
  accessToken: string
  flowJson: Record<string, unknown>
}): Promise<{ success: boolean; validation_errors?: unknown[] }> {
  const url = `${META_API_BASE}/${args.flowId}/assets`
  const form = new FormData()
  form.append('name', 'flow.json')
  form.append('asset_type', 'FLOW_JSON')
  form.append(
    'file',
    new Blob([JSON.stringify(args.flowJson)], { type: 'application/json' }),
    'flow.json'
  )
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.accessToken}` },
    body: form,
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

/** Publish a Flow — moves it from draft to published (immutable JSON
 *  thereafter; further edits require a new Flow). */
export async function publishMetaFlow(args: {
  flowId: string
  accessToken: string
}): Promise<{ success: boolean }> {
  const url = `${META_API_BASE}/${args.flowId}/publish`
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

/** Deprecate a published Flow so it can no longer be sent. */
export async function deprecateMetaFlow(args: {
  flowId: string
  accessToken: string
}): Promise<{ success: boolean }> {
  const url = `${META_API_BASE}/${args.flowId}/deprecate`
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

/** Fetch a Flow's current status + a short-lived preview URL. */
export async function getMetaFlow(args: {
  flowId: string
  accessToken: string
}): Promise<MetaFlowSummary> {
  const url = `${META_API_BASE}/${args.flowId}?fields=id,name,status,categories,preview.invalidate(false)`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${args.accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

// ============================================================
// WhatsApp Business Profile — the customer-facing "About"/description/
// address/photo shown on the business's WhatsApp number, distinct from
// the WABA/Business Manager entities above.
// ============================================================

export type BusinessProfileVertical =
  | 'UNDEFINED'
  | 'OTHER'
  | 'AUTO'
  | 'BEAUTY'
  | 'APPAREL'
  | 'EDU'
  | 'ENTERTAIN'
  | 'EVENT_PLAN'
  | 'FINANCE'
  | 'GROCERY'
  | 'GOVT'
  | 'HOTEL'
  | 'HEALTH'
  | 'NONPROFIT'
  | 'PROF_SERVICES'
  | 'RETAIL'
  | 'TRAVEL'
  | 'RESTAURANT'
  | 'NOT_A_BIZ'

export interface MetaBusinessProfile {
  about?: string
  address?: string
  description?: string
  email?: string
  profile_picture_url?: string
  websites?: string[]
  vertical?: BusinessProfileVertical
}

/** GET the customer-facing WhatsApp Business Profile for a phone number. */
export async function getBusinessProfile(args: {
  phoneNumberId: string
  accessToken: string
}): Promise<MetaBusinessProfile> {
  const { phoneNumberId, accessToken } = args
  const url = `${META_API_BASE}/${phoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { data?: MetaBusinessProfile[] }
  return data.data?.[0] ?? {}
}

export interface UpdateBusinessProfileArgs {
  phoneNumberId: string
  accessToken: string
  about?: string
  address?: string
  description?: string
  email?: string
  websites?: string[]
  vertical?: BusinessProfileVertical
  /** From `uploadResumableMedia` — set to change the profile photo. */
  profilePictureHandle?: string
}

/** Update the customer-facing WhatsApp Business Profile for a phone number. */
export async function updateBusinessProfile(
  args: UpdateBusinessProfileArgs,
): Promise<{ success: boolean }> {
  const { phoneNumberId, accessToken, profilePictureHandle, ...fields } = args
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    ...fields,
  }
  if (profilePictureHandle) body.profile_picture_handle = profilePictureHandle

  const response = await fetch(`${META_API_BASE}/${phoneNumberId}/whatsapp_business_profile`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}
