// ============================================================
// POST /api/v1/ecommerce/webhook — generic ecommerce event → WhatsApp
// notification receiver (Ecommerce Notification Integration spec,
// Phase 2a).
//
// For custom/non-Shopify/WooCommerce backends (an account's own order
// system, a headless storefront, etc.) that already hold a wacrm API
// key. This is NOT a store-platform-native webhook — for Shopify/
// WooCommerce, see the existing `/api/commerce/{shopify,woocommerce}
// /webhook/[connectionId]` routes, which are unrelated and untouched
// by this feature.
//
// Auth: API key with the `messages:send` scope — the same model as
// `/api/v1/messages` (bearer token IS the authentication; there's no
// separate payload signature here because, unlike Razorpay/couriers,
// there's no third-party platform with its own signing convention to
// verify against — the caller already proved who they are with the
// key).
//
// Body:
//   {
//     "event": "order.shipped",              // required — see NOTIFICATION_EVENTS
//     "to": "+14155550123",                   // required, E.164
//     "name": "Jane Doe",                     // optional, names a newly-created contact
//     "data": { "order": { "number": "…" } }, // required, the fields param_mapping reads from
//     "idempotency_key": "…"                  // optional; `Idempotency-Key` header wins
//   }
//
// An event with no active `notification_rules` row configured for
// this account (including one wacrm doesn't recognize at all) is not
// an error — it's logged and the webhook still 200s, so an account
// that hasn't gotten around to configuring a given event doesn't
// cause the caller's delivery system to treat it as a failure and
// retry forever.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { extractIdempotencyKey } from '@/lib/api/v1/idempotency';
import { isNotificationEvent } from '@/lib/notifications/events';
import {
  findActiveNotificationRule,
  resolveTemplateParams,
} from '@/lib/notifications/rules';
import { logNotificationSend } from '@/lib/notifications/logs';
import {
  sendTemplateMessageByPhone,
} from '@/lib/whatsapp/send-template-by-phone';
import { SendMessageError } from '@/lib/whatsapp/send-message';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const event = typeof body.event === 'string' ? body.event.trim() : '';
    if (!event) {
      return fail('bad_request', "'event' is required", 400);
    }

    const to = typeof body.to === 'string' ? body.to.trim() : '';
    if (!to) {
      return fail('bad_request', "'to' is required", 400);
    }

    const data =
      body.data && typeof body.data === 'object'
        ? (body.data as Record<string, unknown>)
        : {};

    // Unknown-to-wacrm event names and known-but-unconfigured events
    // get the same best-effort treatment: log, 200, no send. A
    // sending platform must not see this as a failure worth retrying.
    if (!isNotificationEvent(event)) {
      console.warn(
        `[ecommerce/webhook] account ${ctx.accountId}: unrecognized event "${event}" — skipped`
      );
      await logNotificationSend(ctx.supabase, {
        accountId: ctx.accountId,
        source: 'ecommerce',
        event,
        phone: to,
        status: 'skipped',
        reason: 'unrecognized_event',
      });
      return ok({ skipped: true, reason: 'unrecognized_event' }, 200);
    }

    const rule = await findActiveNotificationRule(ctx.supabase, ctx.accountId, event);
    if (!rule) {
      console.log(
        `[ecommerce/webhook] account ${ctx.accountId}: no active rule for "${event}" — skipped`
      );
      await logNotificationSend(ctx.supabase, {
        accountId: ctx.accountId,
        source: 'ecommerce',
        event,
        phone: to,
        status: 'skipped',
        reason: 'no_rule_configured',
      });
      return ok({ skipped: true, reason: 'no_rule_configured' }, 200);
    }

    const templateParams = resolveTemplateParams(rule.paramMapping, data);
    const idempotencyKey = extractIdempotencyKey(request, body);

    try {
      const outcome = await sendTemplateMessageByPhone(ctx.supabase, ctx.accountId, {
        to,
        name: typeof body.name === 'string' ? body.name : null,
        templateName: rule.templateName,
        templateLanguage: rule.templateLanguage,
        templateParams,
        idempotencyKey,
      });

      if (outcome.status === 'in_progress') {
        await logNotificationSend(ctx.supabase, {
          accountId: ctx.accountId,
          source: 'ecommerce',
          event,
          phone: to,
          templateName: rule.templateName,
          status: 'skipped',
          reason: 'idempotency_in_progress',
        });
        return fail(
          'idempotency_in_progress',
          'A request with this idempotency key is already being processed',
          409
        );
      }

      await logNotificationSend(ctx.supabase, {
        accountId: ctx.accountId,
        source: 'ecommerce',
        event,
        phone: to,
        templateName: rule.templateName,
        status: outcome.status,
      });

      return ok(
        {
          message_id: outcome.result.messageId,
          whatsapp_message_id: outcome.result.whatsappMessageId,
          conversation_id: outcome.result.conversationId,
          contact_id: outcome.result.contactId,
          contact_created: outcome.result.contactCreated,
        },
        201
      );
    } catch (err) {
      await logNotificationSend(ctx.supabase, {
        accountId: ctx.accountId,
        source: 'ecommerce',
        event,
        phone: to,
        templateName: rule.templateName,
        status: 'failed',
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
      throw err;
    }
  } catch (err) {
    if (err instanceof SendMessageError) {
      return fail(err.code, err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
