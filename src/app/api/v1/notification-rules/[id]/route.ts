// ============================================================
// GET    /api/v1/notification-rules/{id} — read a rule
// PATCH  /api/v1/notification-rules/{id} — update template_name/
//                                           template_language/param_mapping
// DELETE /api/v1/notification-rules/{id} — remove a rule
//
// All under scope notifications:manage, account-scoped: a foreign id
// → 404 (never 403). `event` is immutable after creation — delete +
// re-create to move a template to a different event.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  NOTIFICATION_RULE_PUBLIC_COLUMNS,
  serializeNotificationRule,
  normalizeTemplateName,
  normalizeTemplateLanguage,
  normalizeParamMapping,
} from '@/lib/ecommerce/notification-rules';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'notifications:manage');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('notification_rules')
      .select(NOTIFICATION_RULE_PUBLIC_COLUMNS)
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
      const templateName = normalizeTemplateName(body.template_name);
      if (!templateName) {
        return fail(
          'bad_request',
          "'template_name' must be a non-empty string",
          400
        );
      }
      updates.template_name = templateName;
    }

    if ('template_language' in body) {
      const templateLanguage = normalizeTemplateLanguage(
        body.template_language
      );
      if (!templateLanguage) {
        return fail(
          'bad_request',
          "'template_language' must be a non-empty string",
          400
        );
      }
      updates.template_language = templateLanguage;
    }

    if ('param_mapping' in body) {
      const paramMapping = normalizeParamMapping(body.param_mapping);
      if (!paramMapping) {
        return fail(
          'bad_request',
          "'param_mapping' must be an array of non-empty dot-path strings",
          400
        );
      }
      updates.param_mapping = paramMapping;
    }

    if (Object.keys(updates).length === 0) {
      return fail('bad_request', 'No updatable fields provided', 400);
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await ctx.supabase
      .from('notification_rules')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(NOTIFICATION_RULE_PUBLIC_COLUMNS)
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
