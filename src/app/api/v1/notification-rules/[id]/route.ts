// ============================================================
// GET    /api/v1/notification-rules/{id} — read one rule
// PATCH  /api/v1/notification-rules/{id} — update template/mapping/is_active
// DELETE /api/v1/notification-rules/{id} — remove a rule
// Scope: notifications:manage. All account-scoped: a foreign id 404s.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  NOTIFICATION_RULE_COLUMNS,
  serializeNotificationRule,
  normalizeParamMapping,
} from '@/lib/notifications/rules';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'notifications:manage');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('notification_rules')
      .select(NOTIFICATION_RULE_COLUMNS)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/notification-rules] read error:', error);
      return fail('internal', 'Failed to read notification rule', 500);
    }
    if (!data) return fail('not_found', 'Notification rule not found', 404);

    return ok(serializeNotificationRule(data as Record<string, unknown>));
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

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const updates: Record<string, unknown> = {};

    if ('template_name' in body) {
      const name =
        typeof body.template_name === 'string' ? body.template_name.trim() : '';
      if (!name) {
        return fail('bad_request', "'template_name' cannot be empty", 400);
      }
      updates.template_name = name;
    }

    if ('template_language' in body) {
      const lang =
        typeof body.template_language === 'string'
          ? body.template_language.trim()
          : '';
      if (!lang) {
        return fail('bad_request', "'template_language' cannot be empty", 400);
      }
      updates.template_language = lang;
    }

    if ('param_mapping' in body) {
      const mapping = normalizeParamMapping(body.param_mapping);
      if (mapping === null) {
        return fail(
          'bad_request',
          "'param_mapping' must be an array of non-empty dot-path strings",
          400
        );
      }
      updates.param_mapping = mapping;
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
      .from('notification_rules')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(NOTIFICATION_RULE_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/notification-rules] update error:', error);
      return fail('internal', 'Failed to update notification rule', 500);
    }
    if (!data) return fail('not_found', 'Notification rule not found', 404);

    return ok(serializeNotificationRule(data as Record<string, unknown>));
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
      .from('notification_rules')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[api/v1/notification-rules] delete error:', error);
      return fail('internal', 'Failed to delete notification rule', 500);
    }
    if (!data) return fail('not_found', 'Notification rule not found', 404);

    return ok({ id: data.id, deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
