// ============================================================
// POST /api/webhooks/shipping/{configId} — generic carrier webhook
// receiver (docs/ecommerce-integration.md §6).
//
// Not part of the /api/v1 public API surface: your own backend (or
// whatever bridges your courier) POSTs here directly, signed with
// wacrm's own outbound scheme reused in the inbound direction —
// `X-Wacrm-Signature: t=<unix_seconds>,v1=<hex>` — verified against
// the secret you chose in POST /api/v1/shipping-configs.
//
// Body is identical to POST /api/v1/ecommerce/webhook:
//   { "event": "shipment.delivered", "to": "+91…", "name": "…", "data": {…} }
// `event` must be one of the shipment.* events.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { verifySignatureHeader } from '@/lib/webhooks/sign';
import { isShipmentEvent } from '@/lib/ecommerce/events';
import { notifyForEvent } from '@/lib/ecommerce/notify';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
} from '@/lib/ecommerce/idempotency';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ configId: string }> }
) {
  const { configId } = await params;
  const db = supabaseAdmin();

  const { data: config, error: configError } = await db
    .from('shipping_configs')
    .select('id, account_id, webhook_secret')
    .eq('id', configId)
    .maybeSingle();

  if (configError || !config) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-wacrm-signature');

  let secret: string;
  try {
    secret = decrypt(config.webhook_secret);
  } catch (err) {
    console.error('[webhooks/shipping] secret decrypt failed:', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  if (
    !signatureHeader ||
    !verifySignatureHeader(
      signatureHeader,
      rawBody,
      secret,
      Math.floor(Date.now() / 1000)
    )
  ) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!isShipmentEvent(body.event)) {
    return NextResponse.json(
      {
        error:
          "'event' must be one of: shipment.created, shipment.in_transit, shipment.delivered, shipment.failed",
      },
      { status: 400 }
    );
  }
  const event = body.event;

  const to = typeof body.to === 'string' ? body.to.trim() : '';
  if (!to) {
    return NextResponse.json({ error: "'to' is required" }, { status: 400 });
  }

  const idempotencyKey = request.headers.get('idempotency-key')?.trim();
  let claimId: string | null = null;
  if (idempotencyKey) {
    const claim = await claimIdempotencyKey(
      db,
      config.account_id,
      idempotencyKey
    );
    if (claim.outcome === 'in_progress') {
      return NextResponse.json(
        { error: 'idempotency_in_progress' },
        { status: 409 }
      );
    }
    if (claim.outcome === 'replay') {
      return NextResponse.json(claim.body, { status: claim.status });
    }
    claimId = claim.id;
  }

  try {
    const result = await notifyForEvent(db, config.account_id, {
      event,
      to,
      name: typeof body.name === 'string' ? body.name : null,
      data: body.data,
    });

    const response = result.skipped
      ? { skipped: true, reason: result.reason }
      : {
          message_id: result.messageId,
          whatsapp_message_id: result.whatsappMessageId,
          conversation_id: result.conversationId,
          contact_id: result.contactId,
          contact_created: result.contactCreated,
        };
    const status = result.skipped ? 200 : 201;

    if (claimId) {
      await completeIdempotencyKey(db, claimId, 'done', status, response);
    }
    return NextResponse.json(response, { status });
  } catch (err) {
    const errorStatus = err instanceof SendMessageError ? err.status : 500;
    const errorBody =
      err instanceof SendMessageError
        ? { error: { code: err.code, message: err.message } }
        : { error: { code: 'internal', message: 'Internal server error' } };
    if (claimId) {
      await completeIdempotencyKey(
        db,
        claimId,
        'failed',
        errorStatus,
        errorBody
      );
    }
    console.error('[webhooks/shipping] notify failed:', err);
    return NextResponse.json(errorBody, { status: errorStatus });
  }
}
