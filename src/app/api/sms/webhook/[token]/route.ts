import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/sms/encryption'
import { verifySmsWebhookSignature } from '@/lib/sms/webhook-signature'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

// Lazy-initialized to avoid build-time crash when env vars are missing —
// same pattern as the WhatsApp webhook.
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

interface SmsWebhookBody {
  event: string
  payload: Record<string, unknown>
}

interface SmsReceivedPayload {
  messageId: string
  message: string
  phoneNumber: string
  receivedAt: string
}

/**
 * POST /api/sms/webhook/[token]
 *
 * Inbound delivery target for the SMS Gateway Android app
 * (https://github.com/capcom6/android-sms-gateway). `token` is the
 * unguessable routing id from `sms_config.webhook_token` — it tells us
 * which account's `webhook_secret` to verify the HMAC signature
 * against; it carries no trust on its own, so a wrong/expired token
 * and a bad signature both fail closed with the same 401/404.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const { data: config, error: configError } = await supabaseAdmin()
    .from('sms_config')
    .select('account_id, user_id, webhook_secret, enabled')
    .eq('webhook_token', token)
    .maybeSingle()

  if (configError || !config) {
    // 404, not 401 — an unknown token means no account to attribute a
    // signature-verification error to.
    return NextResponse.json({ error: 'Unknown webhook' }, { status: 404 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('x-signature')
  const timestamp = request.headers.get('x-timestamp')

  let secret: string
  try {
    secret = decrypt(config.webhook_secret)
  } catch (err) {
    console.error('[sms/webhook] webhook_secret decryption failed:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!verifySmsWebhookSignature(rawBody, signature, timestamp, secret)) {
    console.warn('[sms/webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Channel paused via Settings → SMS. Still 200 (now that the caller is
  // authenticated) so the gateway doesn't retry-storm us, but skip
  // everything below — no new conversations, no status mirrors, while
  // the account has it turned off.
  if (!config.enabled) {
    return NextResponse.json({ status: 'ignored', reason: 'sms_disabled' }, { status: 200 })
  }

  let body: SmsWebhookBody
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Ack immediately, process after the response — same rationale as the
  // WhatsApp webhook: a slow ack triggers gateway retries, and on
  // Vercel a detached (non-`after()`) promise can be frozen before its
  // DB writes land (issue #301).
  after(async () => {
    try {
      await processEvent(body, config.account_id, config.user_id)
    } catch (err) {
      console.error('[sms/webhook] error processing event:', err)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processEvent(body: SmsWebhookBody, accountId: string, configOwnerUserId: string) {
  switch (body.event) {
    case 'sms:received':
      await handleReceived(body.payload as unknown as SmsReceivedPayload, accountId, configOwnerUserId)
      return
    case 'sms:batch:received': {
      const messages = (body.payload as { messages?: SmsReceivedPayload[] }).messages ?? []
      for (const m of messages) {
        await handleReceived(m, accountId, configOwnerUserId)
      }
      return
    }
    case 'sms:sent':
    case 'sms:delivered':
    case 'sms:failed':
      await handleStatusUpdate(body.event, body.payload as { messageId?: string })
      return
    case 'system:ping':
    case 'app:started':
      return
    default:
      return
  }
}

const STATUS_BY_EVENT: Record<string, string> = {
  'sms:sent': 'sent',
  'sms:delivered': 'delivered',
  'sms:failed': 'failed',
}

async function handleStatusUpdate(event: string, payload: { messageId?: string }) {
  const messageId = payload.messageId
  if (!messageId) return

  const status = STATUS_BY_EVENT[event]
  if (!status) return

  const { error } = await supabaseAdmin()
    .from('messages')
    .update({ status })
    .eq('message_id', messageId)
    .eq('channel', 'sms')

  if (error) {
    console.error('[sms/webhook] error updating message status:', error)
  }
}

async function handleReceived(
  payload: SmsReceivedPayload,
  accountId: string,
  configOwnerUserId: string,
) {
  if (!payload?.phoneNumber || !payload?.messageId) return

  const senderPhone = normalizePhone(payload.phoneNumber)
  const db = supabaseAdmin()

  const contact = await findOrCreateContact(db, accountId, configOwnerUserId, senderPhone)
  if (!contact) return

  const conversation = await findOrCreateConversation(db, accountId, configOwnerUserId, contact.id)
  if (!conversation) return

  const { error: msgError } = await db.from('messages').insert({
    conversation_id: conversation.id,
    channel: 'sms',
    sender_type: 'customer',
    content_type: 'text',
    content_text: payload.message ?? null,
    message_id: payload.messageId,
    status: 'delivered',
    created_at: payload.receivedAt ? new Date(payload.receivedAt).toISOString() : new Date().toISOString(),
  })

  if (msgError) {
    console.error('[sms/webhook] error inserting message:', msgError)
    return
  }

  await db
    .from('conversations')
    .update({
      last_message_text: payload.message ?? '[SMS]',
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)
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
    console.error('[sms/webhook] error creating contact:', error)
    return null
  }
  return created
}

async function findOrCreateConversation(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
): Promise<Row | null> {
  const { data: existingRows, error: findError } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', 'sms')
    .order('created_at', { ascending: true })
    .limit(1)

  if (findError) {
    console.error('[sms/webhook] error finding conversation:', findError)
    return null
  }
  if (existingRows && existingRows.length > 0) return existingRows[0]

  const { data: created, error: createError } = await db
    .from('conversations')
    .insert({ account_id: accountId, user_id: configOwnerUserId, contact_id: contactId, channel: 'sms' })
    .select()
    .single()

  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await db
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .eq('channel', 'sms')
        .order('created_at', { ascending: true })
        .limit(1)
      if (raced && raced.length > 0) return raced[0]
    }
    console.error('[sms/webhook] error creating conversation:', createError)
    return null
  }
  return created
}
