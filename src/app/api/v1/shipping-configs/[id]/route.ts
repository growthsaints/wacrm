// ============================================================
// GET    /api/v1/shipping-configs/{id} — read one config
// PATCH  /api/v1/shipping-configs/{id} — rotate the secret, rename the
//        carrier label, or toggle is_active
// DELETE /api/v1/shipping-configs/{id} — remove a config
// Scope: notifications:manage. All account-scoped: a foreign id 404s.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { encrypt } from '@/lib/whatsapp/encryption';
import {
  SHIPPING_CONFIG_COLUMNS,
  serializeShippingConfig,
} from '@/lib/shipping/configs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'notifications:manage');
    const { id } = await params;
    const origin = new URL(request.url).origin;

    const { data, error } = await ctx.supabase
      .from('shipping_configs')
      .select(SHIPPING_CONFIG_COLUMNS)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/shipping-configs] read error:', error);
      return fail('internal', 'Failed to read shipping config', 500);
    }
    if (!data) return fail('not_found', 'Shipping config not found', 404);

    return ok(serializeShippingConfig(data as Record<string, unknown>, origin));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'notifications:manage');
    const { id } = await params;
    const origin = new URL(request.url).origin;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const updates: Record<string, unknown> = {};

    if ('carrier' in body) {
      const carrier = typeof body.carrier === 'string' ? body.carrier.trim() : '';
      if (!carrier) {
        return fail('bad_request', "'carrier' cannot be empty", 400);
      }
      updates.carrier = carrier;
    }

    if ('webhook_secret' in body) {
      const secret =
        typeof body.webhook_secret === 'string' ? body.webhook_secret.trim() : '';
      if (!secret) {
        return fail('bad_request', "'webhook_secret' cannot be empty", 400);
      }
      updates.webhook_secret = encrypt(secret);
    }

    if ('is_active' in body) {
      if (typeof body.is_active !== 'boolean') {
        return fail('bad_request', "'is_active' must be a boolean", 400);
      }
      updates.is_active = body.is_active;
    }

    if (Object.keys(updates).length === 0) {
      return fail('bad_request', 'No updatable fields provided', 400);
    }

    const { data, error } = await ctx.supabase
      .from('shipping_configs')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(SHIPPING_CONFIG_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/shipping-configs] update error:', error);
      return fail('internal', 'Failed to update shipping config', 500);
    }
    if (!data) return fail('not_found', 'Shipping config not found', 404);

    return ok(serializeShippingConfig(data as Record<string, unknown>, origin));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'notifications:manage');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('shipping_configs')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[api/v1/shipping-configs] delete error:', error);
      return fail('internal', 'Failed to delete shipping config', 500);
    }
    if (!data) return fail('not_found', 'Shipping config not found', 404);

    return ok({ id: data.id, deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
