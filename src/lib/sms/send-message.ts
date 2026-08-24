// ============================================================
// Outbound SMS send core — the SMS-channel counterpart to
// src/lib/whatsapp/send-message.ts's `sendMessageToConversation`.
// Same shape (validate → load conversation/contact/config → send →
// persist), deliberately smaller: SMS supports plain text only, no
// templates/media/interactive/reactions, and (MVP) doesn't pause Flow
// runs since Flows aren't wired to the SMS channel yet.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { sendSms } from '@/lib/sms/gateway-api'
import { decrypt } from '@/lib/sms/encryption'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { countRecentSmsSentByDevice, SMS_DAILY_CAP } from '@/lib/sms/daily-quota'

export class SmsSendError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'SmsSendError'
    this.code = code
    this.status = status
  }
}

export interface SendSmsParams {
  conversationId: string
  messageType: string
  contentText?: string | null
}

export interface SendSmsResult {
  messageId: string
  gatewayMessageId: string
}

export function validateSendSmsParams(params: {
  messageType: string
  contentText?: string | null
}): void {
  if (params.messageType !== 'text') {
    throw new SmsSendError(
      'unsupported_message_type',
      `SMS only supports messageType "text" (got "${params.messageType}")`,
      400,
    )
  }
  if (!params.contentText || !params.contentText.trim()) {
    throw new SmsSendError('bad_request', 'content_text is required for SMS messages', 400)
  }
}

export async function sendSmsToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendSmsParams,
): Promise<SendSmsResult> {
  const { conversationId, messageType, contentText } = params

  if (!conversationId) {
    throw new SmsSendError('bad_request', 'conversation_id is required', 400)
  }
  validateSendSmsParams({ messageType, contentText })

  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .eq('channel', 'sms')
    .single()

  if (convError || !conversation) {
    throw new SmsSendError('not_found', 'SMS conversation not found', 404)
  }

  const contact = conversation.contact
  if (!contact?.phone) {
    throw new SmsSendError('bad_request', 'Contact phone number not found', 400)
  }

  const sanitizedPhone = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitizedPhone)) {
    throw new SmsSendError('bad_request', 'Invalid phone number format', 400)
  }

  // Multi-device (migration 080): the conversation is pinned to whichever
  // device was assigned when it was first created (see
  // findOrCreateConversation in api/whatsapp/send/route.ts) — replies
  // must keep coming from the same device/number or the thread breaks on
  // the customer's end. A conversation with no assignment (pre-migration
  // row, or the device was since deleted) has nothing to send through.
  const smsConfigId: string | null = conversation.sms_config_id
  if (!smsConfigId) {
    throw new SmsSendError(
      'sms_not_configured',
      'This SMS conversation has no gateway device assigned. Reconnect a device in Settings → SMS.',
      400,
    )
  }

  const { data: config, error: configError } = await db
    .from('sms_config')
    .select('*')
    .eq('id', smsConfigId)
    .eq('account_id', accountId)
    .single()

  if (configError || !config) {
    throw new SmsSendError(
      'sms_not_configured',
      'This conversation\'s SMS device no longer exists. Reconnect a device in Settings → SMS.',
      400,
    )
  }

  if (!config.enabled) {
    throw new SmsSendError(
      'sms_disabled',
      'This conversation\'s SMS device is currently disabled in Settings → SMS.',
      403,
    )
  }

  // Per-device daily cap (SMS_DAILY_CAP), checked here so it's enforced
  // for every send path — bulk broadcast, Contact Detail, and Inbox
  // replies alike — rather than only at conversation-creation time.
  const sentToday = await countRecentSmsSentByDevice(db, smsConfigId)
  if (sentToday >= SMS_DAILY_CAP) {
    throw new SmsSendError(
      'sms_daily_cap_reached',
      `This device has reached its daily limit of ${SMS_DAILY_CAP} SMS — it resumes once the rolling 24h window clears. This protects the SIM from carrier throttling/spam flags.`,
      429,
    )
  }

  const password = decrypt(config.password)

  const { data: messageRow, error: insertPendingError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      channel: 'sms',
      sms_config_id: smsConfigId,
      sender_type: 'agent',
      content_type: 'text',
      content_text: contentText,
      status: 'sending',
    })
    .select()
    .single()

  if (insertPendingError || !messageRow) {
    console.error('[sms/send-message] error inserting pending message:', insertPendingError)
    throw new SmsSendError('db_error', 'Failed to create message', 500)
  }

  let gatewayResult: { id: string; state: string }
  try {
    gatewayResult = await sendSms(
      { baseUrl: config.base_url, username: config.username, password },
      { id: messageRow.id, phoneNumbers: [`+${sanitizedPhone}`], text: contentText! },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown SMS gateway error'
    console.error('[sms/send-message] gateway send failed:', message)
    await db.from('messages').update({ status: 'failed' }).eq('id', messageRow.id)
    throw new SmsSendError('gateway_error', message, 502)
  }

  await db
    .from('messages')
    .update({ message_id: gatewayResult.id, status: 'sent' })
    .eq('id', messageRow.id)

  await db
    .from('conversations')
    .update({
      last_message_text: contentText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)

  return { messageId: messageRow.id, gatewayMessageId: gatewayResult.id }
}
