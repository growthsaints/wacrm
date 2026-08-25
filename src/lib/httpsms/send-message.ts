// ============================================================
// Outbound httpSMS send core — the httpSMS-channel counterpart to
// src/lib/sms/send-message.ts (Android SMS Gateway) and
// src/lib/whatsapp/send-message.ts. Same shape (validate → load
// conversation/contact/config → send → persist), smaller: httpSMS is
// plain text only, and there's no per-number daily cap to enforce
// (httpSMS paces sends per phone on its own side) — device selection
// for a NEW conversation happens earlier, in
// lib/httpsms/conversation.ts's resolveHttpSmsConversation.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { sendHttpSms } from '@/lib/httpsms/client'
import { decrypt } from '@/lib/httpsms/encryption'
import { normalizePhone, isValidE164 } from '@/lib/whatsapp/phone-utils'

export class HttpSmsSendError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'HttpSmsSendError'
    this.code = code
    this.status = status
  }
}

export interface SendHttpSmsParams {
  conversationId: string
  messageType: string
  contentText?: string | null
}

export interface SendHttpSmsResult {
  messageId: string
  providerMessageId: string
  httpsmsConfigId: string
}

export function validateSendHttpSmsParams(params: {
  messageType: string
  contentText?: string | null
}): void {
  if (params.messageType !== 'text') {
    throw new HttpSmsSendError(
      'unsupported_message_type',
      `httpSMS only supports messageType "text" (got "${params.messageType}")`,
      400,
    )
  }
  if (!params.contentText || !params.contentText.trim()) {
    throw new HttpSmsSendError('bad_request', 'content_text is required for httpSMS messages', 400)
  }
}

function toE164(phone: string): string {
  const digits = normalizePhone(phone)
  return `+${digits}`
}

export async function sendHttpSmsToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendHttpSmsParams,
): Promise<SendHttpSmsResult> {
  const { conversationId, messageType, contentText } = params

  if (!conversationId) {
    throw new HttpSmsSendError('bad_request', 'conversation_id is required', 400)
  }
  validateSendHttpSmsParams({ messageType, contentText })

  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .eq('channel', 'httpsms')
    .single()

  if (convError || !conversation) {
    throw new HttpSmsSendError('not_found', 'httpSMS conversation not found', 404)
  }

  const contact = conversation.contact
  if (!contact?.phone) {
    throw new HttpSmsSendError('bad_request', 'Contact phone number not found', 400)
  }

  const sanitizedPhone = normalizePhone(contact.phone)
  if (!isValidE164(sanitizedPhone)) {
    throw new HttpSmsSendError('bad_request', 'Invalid phone number format', 400)
  }

  const httpsmsConfigId: string | null = conversation.httpsms_config_id
  if (!httpsmsConfigId) {
    throw new HttpSmsSendError(
      'httpsms_not_configured',
      'This httpSMS conversation has no number assigned. Reconnect a number in Settings → httpSMS.',
      400,
    )
  }

  const { data: config, error: configError } = await db
    .from('httpsms_config')
    .select('*')
    .eq('id', httpsmsConfigId)
    .eq('account_id', accountId)
    .single()

  if (configError || !config) {
    throw new HttpSmsSendError(
      'httpsms_not_configured',
      'This conversation\'s httpSMS number no longer exists. Reconnect a number in Settings → httpSMS.',
      400,
    )
  }

  if (!config.enabled) {
    throw new HttpSmsSendError(
      'httpsms_disabled',
      'This conversation\'s httpSMS number is currently disabled in Settings → httpSMS.',
      403,
    )
  }

  const apiKey = decrypt(config.api_key)

  const { data: messageRow, error: insertPendingError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      channel: 'httpsms',
      httpsms_config_id: httpsmsConfigId,
      sender_type: 'agent',
      content_type: 'text',
      content_text: contentText,
      status: 'sending',
    })
    .select()
    .single()

  if (insertPendingError || !messageRow) {
    console.error('[httpsms/send-message] error inserting pending message:', insertPendingError)
    throw new HttpSmsSendError('db_error', 'Failed to create message', 500)
  }

  let providerResult: { id: string; status: string }
  try {
    providerResult = await sendHttpSms(apiKey, {
      from: toE164(config.phone_number),
      to: toE164(sanitizedPhone),
      content: contentText!,
      requestId: messageRow.id,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown httpSMS error'
    console.error('[httpsms/send-message] send failed:', message)
    await db.from('messages').update({ status: 'failed' }).eq('id', messageRow.id)
    throw new HttpSmsSendError('gateway_error', message, 502)
  }

  await db
    .from('messages')
    .update({ message_id: providerResult.id, status: 'sent' })
    .eq('id', messageRow.id)

  await db
    .from('conversations')
    .update({
      last_message_text: contentText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)

  return { messageId: messageRow.id, providerMessageId: providerResult.id, httpsmsConfigId }
}
