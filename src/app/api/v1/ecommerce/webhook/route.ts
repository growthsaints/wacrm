// ============================================================
// POST /api/v1/ecommerce/webhook — the generic custom-website
// integration point (docs/ecommerce-integration.md).
//
// A custom (non-Shopify/WooCommerce) storefront backend calls this
// once per order/cart lifecycle event. wacrm looks up the account's
// notification_rules row for `event`, maps `data` through the rule's
// param_mapping, and sends the matching WhatsApp template — finding
// or creating the contact/conversation for `to` exactly like
// POST /api/v1/messages does.
//
// Auth: API key with `messages:send` (this endpoint *sends*; managing
// the rules that decide *what* to send needs `notifications:manage`,
// enforced on /api/v1/notification-rules instead).
//
// Body:
//   {
//     "event": "order.shipped",
//     "to": "+919876543210",
//     "name": "Customer Name",           // optional
//     "data": { "order": { "number": "ORD-1042", "tracking_url": "…" } }
//   }
//
// Idempotency-Key header (recommended): a retried call with the same
// key replays the original response instead of sending twice. A
// concurrent call with the same key gets 409 idempotency_in_progress.
//
// Response codes:
//   201 — message sent.
//   200 { skipped: true, reason: "no_rule_configured" } — not an
//        error; this event has no rule configured yet.
//   400 — missing/malformed field, or `data` missing a path the
//        rule's param_mapping needs.
//   409 idempotency_in_progress — a concurrent call with the same
//        Idempotency-Key is already being processed.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { NextResponse } from 'next/server';
import { isOrderEvent } from '@/lib/ecommerce/events';
import { notifyForEvent } from '@/lib/ecommerce/notify';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
} from '@/lib/ecommerce/idempotency';

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

    if (!isOrderEvent(body.event)) {
      return fail(
        'bad_request',
        "'event' must be one of: order.created, order.paid, order.processing, " +
          'order.shipped, order.delivered, order.cancelled, order.refunded, cart.abandoned',
        400
      );
    }
    const event = body.event;

    const to = typeof body.to === 'string' ? body.to.trim() : '';
    if (!to) {
      return fail('bad_request', "'to' is required", 400);
    }

    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    let claimId: string | null = null;

    if (idempotencyKey) {
      const claim = await claimIdempotencyKey(
        ctx.supabase,
        ctx.accountId,
        idempotencyKey
      );
      if (claim.outcome === 'in_progress') {
        return fail(
          'idempotency_in_progress',
          'A request with this Idempotency-Key is already being processed',
          409
        );
      }
      if (claim.outcome === 'replay') {
        return NextResponse.json(claim.body, { status: claim.status });
      }
      claimId = claim.id;
    }

    try {
      const result = await notifyForEvent(ctx.supabase, ctx.accountId, {
        event,
        to,
        name: typeof body.name === 'string' ? body.name : null,
        data: body.data,
      });

      const response = result.skipped
        ? { data: { skipped: true, reason: result.reason } }
        : {
            data: {
              message_id: result.messageId,
              whatsapp_message_id: result.whatsappMessageId,
              conversation_id: result.conversationId,
              contact_id: result.contactId,
              contact_created: result.contactCreated,
            },
          };
      const status = result.skipped ? 200 : 201;

      if (claimId) {
        await completeIdempotencyKey(
          ctx.supabase,
          claimId,
          'done',
          status,
          response
        );
      }
      return NextResponse.json(response, { status });
    } catch (err) {
      if (claimId) {
        const errorResponse =
          err instanceof SendMessageError
            ? { error: { code: err.code, message: err.message } }
            : { error: { code: 'internal', message: 'Internal server error' } };
        const errorStatus = err instanceof SendMessageError ? err.status : 500;
        await completeIdempotencyKey(
          ctx.supabase,
          claimId,
          'failed',
          errorStatus,
          errorResponse
        );
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof SendMessageError) {
      return fail(err.code, err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
