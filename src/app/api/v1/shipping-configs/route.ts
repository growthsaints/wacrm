// ============================================================
// GET  /api/v1/shipping-configs — list configured carriers (scope: notifications:manage)
// POST /api/v1/shipping-configs — register a carrier webhook receiver
//
// Body: { "carrier": "delhivery", "webhook_secret": "<a secret you generate>" }
// Response: { "data": { "id", "carrier", "webhook_url", "created_at" } }
//
// `webhook_secret` is chosen by the caller (not server-generated) —
// sign every call to the returned `webhook_url` with it using
// X-Wacrm-Signature: t=<unix_seconds>,v1=<hex> (same scheme as
// wacrm's own outbound webhooks).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { encrypt } from '@/lib/whatsapp/encryption';
import { getApiBaseUrl } from '@/lib/api/v1/base-url';
import {
  normalizeCarrier,
  normalizeWebhookSecret,
  serializeShippingConfig,
} from '@/lib/ecommerce/shipping';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'notifications:manage');
    const baseUrl = getApiBaseUrl(request);

    const { data, error } = await ctx.supabase
      .from('shipping_configs')
      .select('id, carrier, created_at')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api/v1/shipping-configs] list error:', error);
      return fail('internal', 'Failed to list shipping configs', 500);
    }

    return okList(
      (data ?? []).map((r) => serializeShippingConfig(r, baseUrl)),
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

    const carrier = normalizeCarrier(body.carrier);
    if (!carrier) {
      return fail('bad_request', "'carrier' is required", 400);
    }

    const secret = normalizeWebhookSecret(body.webhook_secret);
    if (!secret) {
      return fail(
        'bad_request',
        "'webhook_secret' is required and must be at least 16 characters",
        400
      );
    }

    const { data: created, error } = await ctx.supabase
      .from('shipping_configs')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.createdBy,
        carrier,
        webhook_secret: encrypt(secret),
      })
      .select('id, carrier, created_at')
      .single();

    if (error || !created) {
      console.error('[api/v1/shipping-configs] create error:', error);
      return fail('internal', 'Failed to register shipping config', 500);
    }

    return ok(serializeShippingConfig(created, baseUrl), 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
