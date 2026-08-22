// ============================================================
// POST /api/v1/payments/webhook/{configId} — payment gateway event →
// WhatsApp notification receiver (Ecommerce Notification Integration
// spec, Phase 2b). Razorpay first; Stripe-extensible via
// `lib/payments/registry.ts`.
//
// Unlike the generic ecommerce receiver (Phase 2a), this is NOT
// API-key authenticated — the gateway posts directly to a URL you
// paste into *its* dashboard, with no wacrm credential in the
// request at all. `{configId}` (a `payment_gateway_configs` row id)
// is how the account + gateway + verification secret get resolved,
// mirroring the existing `/api/commerce/shopify/webhook/[connectionId]`
// pattern. Authenticity comes entirely from verifying the gateway's
// own HMAC signature over the raw body against that config's
// decrypted secret — fail-closed, same posture as the inbound Meta
// webhook (`verifyMetaWebhookSignature`).
//
// Configure a gateway via `POST /api/v1/payment-gateways` (scope
// `notifications:manage`), which returns the `webhook_url` to paste
// into Razorpay's dashboard (Settings → Webhooks).
// ============================================================

import { ok, fail } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import { sendTemplateMessageByPhone } from '@/lib/whatsapp/send-template-by-phone';
import { findActiveNotificationRule, resolveTemplateParams } from '@/lib/notifications/rules';
import { logNotificationSend } from '@/lib/notifications/logs';
import { getGatewayAdapter } from '@/lib/payments/registry';
import { isPaymentGateway } from '@/lib/payments/gateway';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ configId: string }> }
) {
  const { configId } = await params;
  const db = supabaseAdmin();

  const { data: config } = await db
    .from('payment_gateway_configs')
    .select('id, account_id, gateway, webhook_secret, is_active')
    .eq('id', configId)
    .maybeSingle();

  if (!config || !isPaymentGateway(config.gateway)) {
    return fail('not_found', 'Unknown payment gateway config', 404);
  }
  if (!config.is_active) {
    // Disabled by an admin — treat exactly like "doesn't exist" rather
    // than leaking whether a disabled config exists at this URL.
    return fail('not_found', 'Unknown payment gateway config', 404);
  }

  const adapter = getGatewayAdapter(config.gateway);
  const rawBody = await request.text();
  const secret = decrypt(config.webhook_secret as string);

  if (!adapter.verifySignature(rawBody, request.headers, secret)) {
    return fail('unauthorized', 'Invalid webhook signature', 401);
  }

  const parsed = adapter.parseEvent(rawBody);
  if (!parsed) {
    return fail('bad_request', 'Malformed webhook payload', 400);
  }

  if (!parsed.event) {
    console.log(
      `[payments/webhook] account ${config.account_id}: unrecognized ${config.gateway} event — skipped`
    );
    await logNotificationSend(db, {
      accountId: config.account_id,
      source: 'payment',
      event: 'unknown',
      phone: parsed.phone,
      status: 'skipped',
      reason: 'unrecognized_event',
    });
    return ok({ skipped: true, reason: 'unrecognized_event' }, 200);
  }
  if (!parsed.phone) {
    console.log(
      `[payments/webhook] account ${config.account_id}: ${parsed.event} carried no phone number — skipped`
    );
    await logNotificationSend(db, {
      accountId: config.account_id,
      source: 'payment',
      event: parsed.event,
      status: 'skipped',
      reason: 'no_phone_in_payload',
    });
    return ok({ skipped: true, reason: 'no_phone_in_payload' }, 200);
  }

  const rule = await findActiveNotificationRule(db, config.account_id, parsed.event);
  if (!rule) {
    console.log(
      `[payments/webhook] account ${config.account_id}: no active rule for "${parsed.event}" — skipped`
    );
    await logNotificationSend(db, {
      accountId: config.account_id,
      source: 'payment',
      event: parsed.event,
      phone: parsed.phone,
      status: 'skipped',
      reason: 'no_rule_configured',
    });
    return ok({ skipped: true, reason: 'no_rule_configured' }, 200);
  }

  const templateParams = resolveTemplateParams(rule.paramMapping, parsed.data);

  try {
    const outcome = await sendTemplateMessageByPhone(db, config.account_id, {
      to: parsed.phone,
      templateName: rule.templateName,
      templateLanguage: rule.templateLanguage,
      templateParams,
      idempotencyKey: parsed.eventId,
    });

    if (outcome.status === 'in_progress') {
      await logNotificationSend(db, {
        accountId: config.account_id,
        source: 'payment',
        event: parsed.event,
        phone: parsed.phone,
        templateName: rule.templateName,
        status: 'skipped',
        reason: 'idempotency_in_progress',
      });
      return fail(
        'idempotency_in_progress',
        'A delivery for this event is already being processed',
        409
      );
    }

    await logNotificationSend(db, {
      accountId: config.account_id,
      source: 'payment',
      event: parsed.event,
      phone: parsed.phone,
      templateName: rule.templateName,
      status: outcome.status,
    });

    return ok({ ok: true, message_id: outcome.result.messageId }, 200);
  } catch (err) {
    await logNotificationSend(db, {
      accountId: config.account_id,
      source: 'payment',
      event: parsed.event,
      phone: parsed.phone,
      templateName: rule.templateName,
      status: 'failed',
      reason: err instanceof Error ? err.message : 'Unknown error',
    });
    if (err instanceof SendMessageError) {
      return fail(err.code, err.message, err.status);
    }
    console.error('[payments/webhook] send failed:', err);
    return fail('internal', 'Failed to send notification', 500);
  }
}
