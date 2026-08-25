// ============================================================
// Shared "event -> WhatsApp template send" core.
//
// The single place all three ecommerce triggers funnel through:
//   - POST /api/v1/ecommerce/webhook           (generic order/cart events)
//   - POST /api/webhooks/razorpay/{configId}   (payment.* events)
//   - POST /api/webhooks/shipping/{configId}   (shipment.* events)
//
// Looks up the account's notification_rules row for `event`; if none
// is configured, this is not an error (docs/ecommerce-integration.md
// §3: "not an error; this event just has no rule configured yet").
// Otherwise resolves the rule's param_mapping against `data`,
// finds-or-creates the contact/conversation for `to`, and sends the
// mapped template — reusing exactly the same core the dashboard and
// POST /api/v1/messages use, so a notification send is indistinguishable
// from any other template send in the conversation history.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import {
  sendMessageToConversation,
  SendMessageError,
} from '@/lib/whatsapp/send-message';
import { resolveParamMapping } from '@/lib/ecommerce/param-mapping';
import type { NotificationEvent } from '@/lib/ecommerce/events';

export interface NotifyParams {
  event: NotificationEvent;
  to: string;
  name?: string | null;
  data: unknown;
}

export type NotifyResult =
  | {
      skipped: true;
      reason: 'no_rule_configured';
    }
  | {
      skipped: false;
      messageId: string;
      whatsappMessageId: string;
      conversationId: string;
      contactId: string;
      contactCreated: boolean;
    };

interface NotificationRuleRow {
  template_name: string;
  template_language: string;
  param_mapping: string[];
}

/**
 * Run the rule lookup + template send for one event. Throws
 * `SendMessageError` on anything that should map to a public-API
 * error response (bad phone, missing param, WhatsApp not configured,
 * Meta rejection, …) — callers already know how to turn that into the
 * envelope (see POST /api/v1/messages).
 */
export async function notifyForEvent(
  db: SupabaseClient,
  accountId: string,
  params: NotifyParams
): Promise<NotifyResult> {
  const { event, to, name, data } = params;

  const { data: rule, error: ruleError } = await db
    .from('notification_rules')
    .select('template_name, template_language, param_mapping')
    .eq('account_id', accountId)
    .eq('event', event)
    .maybeSingle();

  if (ruleError) {
    console.error('[ecommerce/notify] rule lookup error:', ruleError);
    throw new SendMessageError(
      'db_error',
      'Failed to look up notification rule',
      500
    );
  }

  if (!rule) {
    return { skipped: true, reason: 'no_rule_configured' };
  }

  const row = rule as NotificationRuleRow;
  const mapping = resolveParamMapping(row.param_mapping ?? [], data);
  if (mapping.missingPath) {
    throw new SendMessageError(
      'bad_request',
      `'data' is missing the field required by this rule's param_mapping: '${mapping.missingPath}'`,
      400
    );
  }

  const resolved = await resolveConversationByPhone(db, accountId, to, name);

  const result = await sendMessageToConversation(db, accountId, {
    conversationId: resolved.conversationId,
    messageType: 'template',
    templateName: row.template_name,
    templateLanguage: row.template_language,
    templateParams: mapping.params,
  });

  return {
    skipped: false,
    messageId: result.messageId,
    whatsappMessageId: result.whatsappMessageId,
    conversationId: resolved.conversationId,
    contactId: resolved.contactId,
    contactCreated: resolved.contactCreated,
  };
}
