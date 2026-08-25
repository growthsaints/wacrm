// ============================================================
// POST /api/webhooks/razorpay/{configId} — Razorpay webhook receiver.
//
// Not part of the /api/v1 public API surface: Razorpay calls this
// directly, authenticated by its own HMAC signature scheme (see
// src/lib/ecommerce/razorpay.ts) rather than a wacrm API key. The
// `{configId}` in the path is what ties a delivery back to one
// account's `payment_gateway_configs` row and its secret.
//
// Paste the `webhook_url` from POST /api/v1/payment-gateways into
// Razorpay Dashboard -> Settings -> Webhooks, along with the same
// `webhook_secret` you configured wacrm with.
//
// Always 200s once the signature checks out — Razorpay retries any
// non-2xx response, and a downstream notification failure (no rule
// configured, WhatsApp not connected, …) is not something retrying
// will fix, so we log it and ack rather than trigger a retry storm.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  verifyRazorpaySignature,
  mapRazorpayEvent,
  razorpayIdempotencyKey,
} from '@/lib/ecommerce/razorpay';
import { notifyForEvent } from '@/lib/ecommerce/notify';
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
    .from('payment_gateway_configs')
    .select('id, account_id, gateway, webhook_secret')
    .eq('id', configId)
    .eq('gateway', 'razorpay')
    .maybeSingle();

  if (configError || !config) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-razorpay-signature');

  let secret: string;
  try {
    secret = decrypt(config.webhook_secret);
  } catch (err) {
    console.error('[webhooks/razorpay] secret decrypt failed:', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  if (!verifyRazorpaySignature(rawBody, signatureHeader, secret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const mapped = mapRazorpayEvent(payload);
  if (!mapped) {
    // Unmapped event type, or no usable contact to notify — nothing
    // to do, but a valid, understood delivery.
    return NextResponse.json({ received: true, skipped: true });
  }

  const idempotencyKey = razorpayIdempotencyKey(payload);
  let claimId: string | null = null;
  if (idempotencyKey) {
    const claim = await claimIdempotencyKey(
      db,
      config.account_id,
      idempotencyKey
    );
    if (claim.outcome === 'in_progress') {
      // A concurrent delivery of the same event is already in flight
      // (Razorpay can double-send). Ack without a second send.
      return NextResponse.json({ received: true, in_progress: true });
    }
    if (claim.outcome === 'replay') {
      return NextResponse.json({ received: true, replay: true });
    }
    claimId = claim.id;
  }

  try {
    const result = await notifyForEvent(db, config.account_id, mapped);
    if (claimId) {
      await completeIdempotencyKey(db, claimId, 'done', 200, {
        received: true,
      });
    }
    return NextResponse.json({ received: true, skipped: result.skipped });
  } catch (err) {
    console.error('[webhooks/razorpay] notify failed:', err);
    if (claimId) {
      await completeIdempotencyKey(db, claimId, 'failed', 200, {
        received: true,
      });
    }
    // See file header: ack anyway to avoid a Razorpay retry storm.
    return NextResponse.json({ received: true, notify_failed: true });
  }
}
