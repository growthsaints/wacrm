// ============================================================
// GET    /api/v1/payment-gateways/{id} — read a gateway config
// DELETE /api/v1/payment-gateways/{id} — disconnect a gateway
//
// Both scope notifications:manage, account-scoped: a foreign id →
// 404. There is no PATCH — rotate a secret by POSTing again (upsert
// on account_id+gateway) rather than editing in place.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getApiBaseUrl } from '@/lib/api/v1/base-url';
import { serializePaymentGatewayConfig } from '@/lib/ecommerce/gateways';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'notifications:manage');
    const { id } = await params;
    const baseUrl = getApiBaseUrl(request);

    const { data, error } = await ctx.supabase
      .from('payment_gateway_configs')
      .select('id, gateway, created_at')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/payment-gateways] read error:', error);
      return fail('internal', 'Failed to read payment gateway', 500);
    }
    if (!data) return fail('not_found', 'Payment gateway not found', 404);

    return ok(serializePaymentGatewayConfig(data, baseUrl));
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
      .from('payment_gateway_configs')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[api/v1/payment-gateways] delete error:', error);
      return fail('internal', 'Failed to disconnect payment gateway', 500);
    }
    if (!data) return fail('not_found', 'Payment gateway not found', 404);

    return ok({ id: data.id, deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
