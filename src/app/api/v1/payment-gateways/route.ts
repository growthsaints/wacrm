// ============================================================
// GET  /api/v1/payment-gateways — list configured gateways (scope: notifications:manage)
// POST /api/v1/payment-gateways — connect a gateway
//
// Body: { "gateway": "razorpay", "webhook_secret": "<your Razorpay webhook secret>" }
// Response: { "data": { "id", "gateway", "webhook_url", "created_at" } }
//
// Unlike POST /api/v1/webhooks, `webhook_secret` here is a REQUEST
// field, not server-generated: Razorpay's dashboard requires you to
// set a specific secret string, so wacrm stores exactly the one you
// give it (encrypted at rest) rather than minting its own. Paste the
// returned `webhook_url` into Razorpay Dashboard -> Settings ->
// Webhooks, using the same secret.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { encrypt } from '@/lib/whatsapp/encryption';
import { getApiBaseUrl } from '@/lib/api/v1/base-url';
import {
  isPaymentGateway,
  normalizeWebhookSecret,
  serializePaymentGatewayConfig,
} from '@/lib/ecommerce/gateways';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'notifications:manage');
    const baseUrl = getApiBaseUrl(request);

    const { data, error } = await ctx.supabase
      .from('payment_gateway_configs')
      .select('id, gateway, created_at')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api/v1/payment-gateways] list error:', error);
      return fail('internal', 'Failed to list payment gateways', 500);
    }

    return okList(
      (data ?? []).map((r) => serializePaymentGatewayConfig(r, baseUrl)),
      null
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'notifications:manage');
    const baseUrl = getApiBaseUrl(request);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    if (!isPaymentGateway(body.gateway)) {
      return fail('bad_request', "'gateway' must be one of: razorpay", 400);
    }
    const gateway = body.gateway;

    const secret = normalizeWebhookSecret(body.webhook_secret);
    if (!secret) {
      return fail(
        'bad_request',
        "'webhook_secret' is required and must be at least 16 characters",
        400
      );
    }

    const { data: created, error } = await ctx.supabase
      .from('payment_gateway_configs')
      .upsert(
        {
          account_id: ctx.accountId,
          created_by: ctx.createdBy,
          gateway,
          webhook_secret: encrypt(secret),
        },
        { onConflict: 'account_id,gateway' }
      )
      .select('id, gateway, created_at')
      .single();

    if (error || !created) {
      console.error('[api/v1/payment-gateways] create error:', error);
      return fail('internal', 'Failed to connect payment gateway', 500);
    }

    return ok(serializePaymentGatewayConfig(created, baseUrl), 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
