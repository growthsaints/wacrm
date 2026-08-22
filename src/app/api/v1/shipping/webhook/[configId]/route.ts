// ============================================================
// POST /api/v1/shipping/webhook/{configId} — shipping/courier event →
// WhatsApp notification receiver (Ecommerce Notification Integration
// spec, Phase 2c).
//
// No single dominant courier API/signature convention exists to adapt
// to (unlike Razorpay for payments), so this defines its own: sign
// requests with `X-Wacrm-Signature: t=<unix>,v1=<hex>` using the
// `webhook_secret` from `POST /api/v1/shipping-configs` — the exact
// scheme wacrm's own outbound webhooks use (`lib/webhooks/sign.ts`),
// reused here rather than inventing a second one. Put this signing
// step in whatever middleware/relay sits in front of your actual
// courier, or in your own fulfillment system if it's custom-built.
//
// Body (after signature verification, same envelope as the generic
// ecommerce receiver):
//   {
//     "event": "shipment.delivered",           // required — a shipment.* NOTIFICATION_EVENT
//     "to": "+14155550123",                     // required, E.164
//     "name": "Jane Doe",                       // optional, names a newly-created contact
//     "data": { "shipment": { "tracking_number": "…" } },
//     "idempotency_key": "…"                    // optional; recommended for retried deliveries
//   }
// ============================================================

import { ok, fail } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { verifySignatureHeader } from '@/lib/webhooks/sign';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import { sendTemplateMessageByPhone } from '@/lib/whatsapp/send-template-by-phone';
import { SHIPPING_EVENTS } from '@/lib/notifications/events';
import { findActiveNotificationRule, resolveTemplateParams } from '@/lib/notifications/rules';
import { logNotificationSend } from '@/lib/notifications/logs';

function isShippingEvent(value: string): value is (typeof SHIPPING_EVENTS)[number] {
  return (SHIPPING_EVENTS as readonly string[]).includes(value);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ configId: string }> }
) {
  const { configId } = await params;
  const db = supabaseAdmin();

  const { data: config } = await db
    .from('shipping_configs')
    .select('id, account_id, webhook_secret, is_active')
    .eq('id', configId)
    .maybeSingle();

  if (!config) {
    return fail('not_found', 'Unknown shipping config', 404);
  }
  if (!config.is_active) {
    // Disabled — treat exactly like "doesn't exist" rather than
    // leaking whether a disabled config exists at this URL.
    return fail('not_found', 'Unknown shipping config', 404);
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-wacrm-signature');
  if (!signatureHeader) {
    return fail('unauthorized', 'Missing X-Wacrm-Signature header', 401);
  }

  const secret = decrypt(config.webhook_secret as string);
  const valid = verifySignatureHeader(
    signatureHeader,
    rawBody,
    secret,
    Math.floor(Date.now() / 1000)
  );
  if (!valid) {
    return fail('unauthorized', 'Invalid webhook signature', 401);
  }

  const body = (() => {
    try {
      return JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
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

  if (!isShippingEvent(event)) {
    console.warn(
      `[shipping/webhook] account ${config.account_id}: unrecognized event "${event}" — skipped`
    );
    await logNotificationSend(db, {
      accountId: config.account_id,
      source: 'shipping',
      event,
      phone: to,
      status: 'skipped',
      reason: 'unrecognized_event',
    });
    return ok({ skipped: true, reason: 'unrecognized_event' }, 200);
  }

  const rule = await findActiveNotificationRule(db, config.account_id, event);
  if (!rule) {
    console.log(
      `[shipping/webhook] account ${config.account_id}: no active rule for "${event}" — skipped`
    );
    await logNotificationSend(db, {
      accountId: config.account_id,
      source: 'shipping',
      event,
      phone: to,
      status: 'skipped',
      reason: 'no_rule_configured',
    });
    return ok({ skipped: true, reason: 'no_rule_configured' }, 200);
  }

  const templateParams = resolveTemplateParams(rule.paramMapping, data);
  const idempotencyKey =
    typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : null;

  try {
    const outcome = await sendTemplateMessageByPhone(db, config.account_id, {
      to,
      name: typeof body.name === 'string' ? body.name : null,
      templateName: rule.templateName,
      templateLanguage: rule.templateLanguage,
      templateParams,
      idempotencyKey,
    });

    if (outcome.status === 'in_progress') {
      await logNotificationSend(db, {
        accountId: config.account_id,
        source: 'shipping',
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

    await logNotificationSend(db, {
      accountId: config.account_id,
      source: 'shipping',
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
    await logNotificationSend(db, {
      accountId: config.account_id,
      source: 'shipping',
      event,
      phone: to,
      templateName: rule.templateName,
      status: 'failed',
      reason: err instanceof Error ? err.message : 'Unknown error',
    });
    if (err instanceof SendMessageError) {
      return fail(err.code, err.message, err.status);
    }
    console.error('[shipping/webhook] send failed:', err);
    return fail('internal', 'Failed to send notification', 500);
  }
}
