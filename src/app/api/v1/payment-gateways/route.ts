// ============================================================
// GET  /api/v1/payment-gateways — list configured payment gateways
//      (notifications:manage)
// POST /api/v1/payment-gateways — connect a gateway
//      (notifications:manage)
//
// POST returns `webhook_url` — paste it into the gateway's own
// dashboard (Razorpay: Settings → Webhooks) alongside the same
// `webhook_secret` you configured there.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { encrypt } from '@/lib/whatsapp/encryption';
import { isPaymentGateway } from '@/lib/payments/gateway';
import {
  PAYMENT_GATEWAY_CONFIG_COLUMNS,
  serializePaymentGatewayConfig,
} from '@/lib/payments/configs';

/** Postgres unique_violation — thrown by the (account_id, gateway) index. */
const UNIQUE_VIOLATION = '23505';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'notifications:manage');
    const origin = new URL(request.url).origin;

    const { data, error } = await ctx.supabase
      .from('payment_gateway_configs')
      .select(PAYMENT_GATEWAY_CONFIG_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api/v1/payment-gateways] list error:', error);
      return fail('internal', 'Failed to list payment gateways', 500);
    }

    return okList(
      (data ?? []).map((r) =>
        serializePaymentGatewayConfig(r as Record<string, unknown>, origin)
      ),
      null
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'notifications:manage');
    const origin = new URL(request.url).origin;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const gateway = typeof body.gateway === 'string' ? body.gateway : '';
    if (!isPaymentGateway(gateway)) {
      return fail(
        'bad_request',
        "'gateway' must be one of the supported payment gateways",
        400
      );
    }

    const webhookSecret =
      typeof body.webhook_secret === 'string' ? body.webhook_secret.trim() : '';
    if (!webhookSecret) {
      return fail(
        'bad_request',
        "'webhook_secret' is required — the signing secret from your gateway's dashboard",
        400
      );
    }

    const { data: created, error } = await ctx.supabase
      .from('payment_gateway_configs')
      .insert({
        account_id: ctx.accountId,
        gateway,
        webhook_secret: encrypt(webhookSecret),
      })
      .select(PAYMENT_GATEWAY_CONFIG_COLUMNS)
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return fail(
          'bad_request',
          `A "${gateway}" config already exists for this account — use PATCH /api/v1/payment-gateways/{id} to update it`,
          409
        );
      }
      console.error('[api/v1/payment-gateways] create error:', error);
      return fail('internal', 'Failed to create payment gateway config', 500);
    }

    return ok(
      serializePaymentGatewayConfig(created as Record<string, unknown>, origin),
      201
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
