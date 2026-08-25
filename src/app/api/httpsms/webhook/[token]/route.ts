import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
 * POST /api/httpsms/webhook/[token]
 *
 * Inbound delivery target for httpsms.com (github.com/NdoleStudio/
 * httpsms) — pasted into their dashboard's webhook settings for a
 * connected number. `token` is the unguessable routing id from
 * `httpsms_config.webhook_token`, same trust model as the SMS Gateway
 * webhook route.
 *
 * KNOWN GAP: httpSMS's exact webhook payload shape and signature
 * header aren't confirmed from their (offline-to-us) docs — their
 * swagger only confirms the outbound send API in detail. This handler
 * is deliberately defensive: it doesn't enforce a signature (there's
 * nothing to enforce against an unconfirmed header name), and it
 * tries several plausible field-name shapes for an inbound message
 * rather than committing to one. Any payload that doesn't look like a
 * message gets logged and 200'd rather than rejected, so httpSMS
 * doesn't retry-storm us while this gets tightened up against a real
 * account's traffic.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const { data: config, error: configError } = await supabaseAdmin()
    .from('httpsms_config')
    .select('id, account_id, user_id, enabled')
    .eq('webhook_token', token)
    .maybeSingle()

  if (configError || !config) {
    return NextResponse.json({ error: 'Unknown webhook' }, { status: 404 })
  }

  if (!config.enabled) {
    return NextResponse.json({ status: 'ignored', reason: 'httpsms_disabled' }, { status: 200 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Ack immediately, process after the response — same rationale as
  // every other webhook in this codebase (WhatsApp, SMS Gateway): a
  // slow ack triggers sender-side retries, and a detached (non-after())
  // promise can be frozen before its DB writes land on some platforms.
  after(async () => {
    try {
      await processEvent(body, config.id, config.account_id, config.user_id)
    } catch (err) {
      console.error('[httpsms/webhook] error processing event:', err)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

interface ParsedInboundMessage {
  from: string
  content: string
  providerMessageId: string | null
  receivedAt: string | null
}

/** Best-effort extraction across the field-name shapes httpSMS's
 *  webhook plausibly uses — see the KNOWN GAP note above. */
function parseInboundMessage(body: unknown): ParsedInboundMessage | null {
  if (!body || typeof body !== 'object') return null
  const root = body as Record<string, unknown>
  // The message fields may be at the top level, or nested under
  // `data`/`message`/`payload` if httpSMS wraps events like our own
  // SMS Gateway webhook does ({ event, payload }).
  const candidates = [root, root.data, root.message, root.payload].filter(
    (c): c is Record<string, unknown> => !!c && typeof c === 'object',
  )

  for (const c of candidates) {
    const from = c.from ?? c.contact ?? c.sender
    const content = c.content ?? c.text ?? c.body ?? c.message
    if (typeof from === 'string' && from.trim() && typeof content === 'string' && content.trim()) {
      const id = c.id ?? c.message_id ?? c.messageId
      const timestamp = c.timestamp ?? c.created_at ?? c.received_at
      return {
        from,
        content,
        providerMessageId: typeof id === 'string' ? id : null,
        receivedAt: typeof timestamp === 'string' ? timestamp : null,
      }
    }
  }
  return null
}

async function processEvent(
  body: unknown,
  httpsmsConfigId: string,
  accountId: string,
  configOwnerUserId: string,
) {
  const parsed = parseInboundMessage(body)
  if (!parsed) {
    // Not a shape we recognize as an inbound message (could be a
    // status-change event for an outbound send, or a shape we haven't
    // seen yet) — log it so the exact contract can be confirmed and
    // this handler tightened, rather than guessing further.
    console.warn('[httpsms/webhook] unrecognized payload shape, ignoring:', JSON.stringify(body).slice(0, 2000))
    return
  }

  const senderPhone = normalizePhone(parsed.from)
  if (!senderPhone) return

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
    content_text: parsed.content,
    message_id: parsed.providerMessageId,
    status: 'delivered',
    created_at: parsed.receivedAt ? new Date(parsed.receivedAt).toISOString() : new Date().toISOString(),
  })

  if (msgError) {
    console.error('[httpsms/webhook] error inserting message:', msgError)
    return
  }

  await db
    .from('conversations')
    .update({
      last_message_text: parsed.content,
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
