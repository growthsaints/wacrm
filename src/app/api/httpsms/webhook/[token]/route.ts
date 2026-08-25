import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/httpsms/encryption'
import { verifyHttpSmsWebhookAuth } from '@/lib/httpsms/webhook-signature'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

// Lazy-initialized to avoid build-time crash when env vars are missing —
// same pattern as the WhatsApp/SMS webhooks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

/**
 * httpSMS wraps every webhook payload as a CloudEvent
 * (docs.httpsms.com/webhooks/introduction):
 * `{ data: {...}, type: "message.phone.received", source, id, time,
 *    specversion, datacontenttype }`. `data`'s shape depends on `type`
 * — see handleReceived/handleStatusEvent below for the fields each
 * one actually uses.
 */
interface HttpSmsCloudEvent {
  type?: string
  data?: Record<string, unknown>
}

const STATUS_BY_EVENT: Record<string, string> = {
  'message.phone.sent': 'sent',
  'message.phone.delivered': 'delivered',
  'message.send.failed': 'failed',
  'message.send.expired': 'failed',
}

/**
 * POST /api/httpsms/webhook/[token]
 *
 * Inbound delivery target for httpsms.com — registered automatically
 * against their API when a number is connected (see
 * lib/httpsms/client.ts's registerHttpSmsWebhook, called from
 * /api/httpsms/config's POST). `token` is the unguessable routing id
 * from `httpsms_config.webhook_token`; the `Authorization: Bearer
 * <JWT>` header is the actual authenticity check, verified against
 * that config's own `webhook_secret`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const { data: config, error: configError } = await supabaseAdmin()
    .from('httpsms_config')
    .select('id, account_id, user_id, webhook_secret, enabled')
    .eq('webhook_token', token)
    .maybeSingle()

  if (configError || !config) {
    // 404, not 401 — an unknown token means no account to attribute a
    // signature-verification error to.
    return NextResponse.json({ error: 'Unknown webhook' }, { status: 404 })
  }

  let secret: string
  try {
    secret = decrypt(config.webhook_secret)
  } catch (err) {
    console.error('[httpsms/webhook] webhook_secret decryption failed:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!verifyHttpSmsWebhookAuth(request.headers.get('authorization'), secret)) {
    console.warn('[httpsms/webhook] rejected request with invalid/missing Authorization')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Channel paused via Settings → httpSMS. Still 200 (now that the
  // caller is authenticated) so httpSMS doesn't retry-storm us — they
  // retry up to 4 times on a non-2xx response.
  if (!config.enabled) {
    return NextResponse.json({ status: 'ignored', reason: 'httpsms_disabled' }, { status: 200 })
  }

  let event: HttpSmsCloudEvent
  try {
    event = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Ack immediately, process after the response — same rationale as
  // every other webhook in this codebase: httpSMS gives only a 5
  // second timeout before treating the request as failed and retrying.
  after(async () => {
    try {
      await processEvent(event, config.id, config.account_id, config.user_id)
    } catch (err) {
      console.error('[httpsms/webhook] error processing event:', err)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processEvent(
  event: HttpSmsCloudEvent,
  httpsmsConfigId: string,
  accountId: string,
  configOwnerUserId: string,
) {
  const type = event.type
  const data = event.data
  if (!type || !data) return

  if (type === 'message.phone.received') {
    await handleReceived(data, httpsmsConfigId, accountId, configOwnerUserId)
    return
  }

  const status = STATUS_BY_EVENT[type]
  if (status) {
    await handleStatusEvent(data, status)
    return
  }

  // phone.heartbeat.online/offline, message.call.missed — nothing to
  // do with SMS threading, no-op.
}

/** data: { contact, content, id, owner, sim, timestamp } per
 *  docs.httpsms.com/webhooks/events#message-phone-received */
async function handleReceived(
  data: Record<string, unknown>,
  httpsmsConfigId: string,
  accountId: string,
  configOwnerUserId: string,
) {
  const senderPhone = typeof data.contact === 'string' ? normalizePhone(data.contact) : ''
  const content = typeof data.content === 'string' ? data.content : ''
  if (!senderPhone || !content) return

  const providerMessageId = typeof data.id === 'string' ? data.id : null
  const receivedAt = typeof data.timestamp === 'string' ? data.timestamp : null

  const db = supabaseAdmin()

  const contact = await findOrCreateContact(db, accountId, configOwnerUserId, senderPhone)
  if (!contact) return

  const conversation = await findOrCreateConversation(db, accountId, configOwnerUserId, contact.id, httpsmsConfigId)
  if (!conversation) return

  const { error: msgError } = await db.from('messages').insert({
    conversation_id: conversation.id,
    channel: 'httpsms',
    httpsms_config_id: httpsmsConfigId,
    sender_type: 'customer',
    content_type: 'text',
    content_text: content,
    message_id: providerMessageId,
    status: 'delivered',
    created_at: receivedAt ? new Date(receivedAt).toISOString() : new Date().toISOString(),
  })

  if (msgError) {
    console.error('[httpsms/webhook] error inserting message:', msgError)
    return
  }

  await db
    .from('conversations')
    .update({
      last_message_text: content,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)
}

/** data: { id, request_id, ... } — `id` is the provider message id we
 *  stored as messages.message_id when the original send response came
 *  back (see lib/httpsms/send-message.ts). Scoped to channel='httpsms'
 *  for the same reason the SMS Gateway status handler scopes by
 *  channel — provider message ids aren't guaranteed globally unique
 *  across every channel/provider this app talks to. */
async function handleStatusEvent(data: Record<string, unknown>, status: string) {
  const providerMessageId = typeof data.id === 'string' ? data.id : null
  if (!providerMessageId) return

  const { error } = await supabaseAdmin()
    .from('messages')
    .update({ status })
    .eq('message_id', providerMessageId)
    .eq('channel', 'httpsms')

  if (error) {
    console.error('[httpsms/webhook] error updating message status:', error)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

async function findOrCreateContact(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  configOwnerUserId: string,
  phone: string,
): Promise<Row | null> {
  const existing = await findExistingContact(db, accountId, phone)
  if (existing) return existing

  const { data: created, error } = await db
    .from('contacts')
    .insert({ account_id: accountId, user_id: configOwnerUserId, phone, name: phone })
    .select()
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      return await findExistingContact(db, accountId, phone)
    }
    console.error('[httpsms/webhook] error creating contact:', error)
    return null
  }
  return created
}

async function findOrCreateConversation(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  httpsmsConfigId: string,
): Promise<Row | null> {
  const { data: existingRows, error: findError } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', 'httpsms')
    .order('created_at', { ascending: true })
    .limit(1)

  if (findError) {
    console.error('[httpsms/webhook] error finding conversation:', findError)
    return null
  }
  if (existingRows && existingRows.length > 0) return existingRows[0]

  const { data: created, error: createError } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
      channel: 'httpsms',
      httpsms_config_id: httpsmsConfigId,
    })
    .select()
    .single()

  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await db
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .eq('channel', 'httpsms')
        .order('created_at', { ascending: true })
        .limit(1)
      if (raced && raced.length > 0) return raced[0]
    }
    console.error('[httpsms/webhook] error creating conversation:', createError)
    return null
  }
  return created
}
