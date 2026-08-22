// ============================================================
// GET    /api/v1/shipping-configs/{id} — read a config
// DELETE /api/v1/shipping-configs/{id} — remove a config
//
// Both scope notifications:manage, account-scoped: a foreign id → 404.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getApiBaseUrl } from '@/lib/api/v1/base-url';
import { serializeShippingConfig } from '@/lib/ecommerce/shipping';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'notifications:manage');
    const { id } = await params;
    const baseUrl = getApiBaseUrl(request);

    const { data, error } = await ctx.supabase
      .from('shipping_configs')
      .select('id, carrier, created_at')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/shipping-configs] read error:', error);
      return fail('internal', 'Failed to read shipping config', 500);
    }
    if (!data) return fail('not_found', 'Shipping config not found', 404);

    return ok(serializeShippingConfig(data, baseUrl));
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
      return fail('internal', 'Failed to remove shipping config', 500);
    }
    if (!data) return fail('not_found', 'Shipping config not found', 404);

    return ok({ id: data.id, deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
