// ============================================================
// GET    /api/v1/payment-gateways/{id} — read one config
// PATCH  /api/v1/payment-gateways/{id} — rotate the secret or toggle is_active
// DELETE /api/v1/payment-gateways/{id} — remove a config
// Scope: notifications:manage. All account-scoped: a foreign id 404s.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { encrypt } from '@/lib/whatsapp/encryption';
import {
  PAYMENT_GATEWAY_CONFIG_COLUMNS,
  serializePaymentGatewayConfig,
} from '@/lib/payments/configs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'notifications:manage');
    const { id } = await params;
    const origin = new URL(request.url).origin;

    const { data, error } = await ctx.supabase
      .from('payment_gateway_configs')
      .select(PAYMENT_GATEWAY_CONFIG_COLUMNS)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/payment-gateways] read error:', error);
      return fail('internal', 'Failed to read payment gateway config', 500);
    }
    if (!data) return fail('not_found', 'Payment gateway config not found', 404);

    return ok(serializePaymentGatewayConfig(data as Record<string, unknown>, origin));
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
      .from('payment_gateway_configs')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(PAYMENT_GATEWAY_CONFIG_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/payment-gateways] update error:', error);
      return fail('internal', 'Failed to update payment gateway config', 500);
    }
    if (!data) return fail('not_found', 'Payment gateway config not found', 404);

    return ok(serializePaymentGatewayConfig(data as Record<string, unknown>, origin));
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
      return fail('internal', 'Failed to delete payment gateway config', 500);
    }
    if (!data) return fail('not_found', 'Payment gateway config not found', 404);

    return ok({ id: data.id, deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
