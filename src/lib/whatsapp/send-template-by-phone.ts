// ============================================================
// Send a WhatsApp template message to a phone number, with built-in
// idempotency — the shared core for the ecommerce/payment/shipping
// notification receivers (Phase 2a/2b/2c). Each receiver normalizes
// its own webhook payload, looks up a `notification_rules` row, and
// calls this once, instead of each re-implementing "resolve phone →
// conversation, then send, with dedup" independently.
//
// Kept in its own file rather than added to `send-message.ts` to
// avoid introducing a real circular import (`resolve-conversation.ts`
// already imports `SendMessageError` from `send-message.ts`).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import {
  sendMessageToConversation,
  type SendMessageResult,
} from '@/lib/whatsapp/send-message';
import {
  reserveIdempotencyKey,
  fillIdempotencyKey,
  releaseIdempotencyKey,
} from '@/lib/api/v1/idempotency';

export interface SendTemplateByPhoneParams {
  to: string;
  /** Names a newly-created contact; ignored if one already exists. */
  name?: string | null;
  templateName: string;
  templateLanguage?: string | null;
  templateParams?: string[];
  /**
   * Dedup key for the *inbound* webhook delivery that triggered this
   * send (e.g. the source platform's own event/delivery id) — a
   * retried delivery (Shopify, Razorpay, and most courier webhooks all
   * retry on a non-2xx or timeout) replays the prior outcome instead
   * of sending the WhatsApp message a second time. Omit for callers
   * that don't need replay safety.
   */
  idempotencyKey?: string | null;
}

export interface SendTemplateByPhoneResult extends SendMessageResult {
  conversationId: string;
  contactId: string;
  contactCreated: boolean;
}

export type SendTemplateOutcome =
  | { status: 'sent'; result: SendTemplateByPhoneResult }
  | { status: 'replayed'; result: SendTemplateByPhoneResult }
  // A concurrent delivery for the same idempotencyKey is still in
  // flight — callers should treat this like a transient failure (log,
  // 200 the webhook anyway; the source will retry and it'll resolve).
  | { status: 'in_progress' };

/**
 * Resolve `to` to a conversation and send a template message, wrapped
 * in the reserve/fill/release idempotency dance from
 * `lib/api/v1/idempotency.ts` when `idempotencyKey` is given.
 */
export async function sendTemplateMessageByPhone(
  db: SupabaseClient,
  accountId: string,
  params: SendTemplateByPhoneParams
): Promise<SendTemplateOutcome> {
  const reservation = await reserveIdempotencyKey(
    db,
    accountId,
    params.idempotencyKey ?? null
  );
  if (reservation.status === 'replay') {
    return {
      status: 'replayed',
      result: reservation.responseBody as SendTemplateByPhoneResult,
    };
  }
  if (reservation.status === 'in_progress') {
    return { status: 'in_progress' };
  }

  const tracking = reservation.status === 'reserved' && params.idempotencyKey;

  try {
    const resolved = await resolveConversationByPhone(
      db,
      accountId,
      params.to,
      params.name ?? null
    );
    const sent = await sendMessageToConversation(db, accountId, {
      conversationId: resolved.conversationId,
      messageType: 'template',
      templateName: params.templateName,
      templateLanguage: params.templateLanguage ?? null,
      templateParams: params.templateParams,
    });

    const result: SendTemplateByPhoneResult = {
      ...sent,
      conversationId: resolved.conversationId,
      contactId: resolved.contactId,
      contactCreated: resolved.contactCreated,
    };

    if (tracking) {
      await fillIdempotencyKey(
        db,
        accountId,
        params.idempotencyKey as string,
        result,
        sent.messageId
      );
    }

    return { status: 'sent', result };
  } catch (err) {
    if (tracking) {
      await releaseIdempotencyKey(db, accountId, params.idempotencyKey as string);
    }
    throw err;
  }
}
