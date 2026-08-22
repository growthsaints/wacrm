// ============================================================
// GET  /api/v1/shipping-configs — list configured shipping/courier
//      webhook targets                            (notifications:manage)
// POST /api/v1/shipping-configs — register one     (notifications:manage)
//
// POST returns `webhook_url` + expects you to sign calls to it with
// the *same* `webhook_secret`, Stripe-style — see
// `lib/webhooks/sign.ts`'s `buildSignatureHeader` (the same scheme
// wacrm's own outbound webhooks use) for the exact header shape.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { encrypt } from '@/lib/whatsapp/encryption';
import {
  SHIPPING_CONFIG_COLUMNS,
  serializeShippingConfig,
} from '@/lib/shipping/configs';

/** Postgres unique_violation — thrown by the (account_id, carrier) index. */
const UNIQUE_VIOLATION = '23505';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'notifications:manage');
    const origin = new URL(request.url).origin;

    const { data, error } = await ctx.supabase
      .from('shipping_configs')
      .select(SHIPPING_CONFIG_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api/v1/shipping-configs] list error:', error);
      return fail('internal', 'Failed to list shipping configs', 500);
    }

    return okList(
      (data ?? []).map((r) =>
        serializeShippingConfig(r as Record<string, unknown>, origin)
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

    const carrier = typeof body.carrier === 'string' ? body.carrier.trim() : '';
    if (!carrier) {
      return fail(
        'bad_request',
        "'carrier' is required — a label for your own reference (e.g. \"delhivery\")",
        400
      );
    }

    const webhookSecret =
      typeof body.webhook_secret === 'string' ? body.webhook_secret.trim() : '';
    if (!webhookSecret) {
      return fail('bad_request', "'webhook_secret' is required", 400);
    }

    const { data: created, error } = await ctx.supabase
      .from('shipping_configs')
      .insert({
        account_id: ctx.accountId,
        carrier,
        webhook_secret: encrypt(webhookSecret),
      })
      .select(SHIPPING_CONFIG_COLUMNS)
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return fail(
          'bad_request',
          `A config for carrier "${carrier}" already exists — use PATCH /api/v1/shipping-configs/{id} to update it`,
          409
        );
      }
      console.error('[api/v1/shipping-configs] create error:', error);
      return fail('internal', 'Failed to create shipping config', 500);
    }

    return ok(
      serializeShippingConfig(created as Record<string, unknown>, origin),
      201
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
