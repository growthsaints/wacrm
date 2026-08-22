// ============================================================
// GET  /api/v1/notification-rules — list rules (scope: notifications:manage)
// POST /api/v1/notification-rules — create/replace a rule for one event
//
// One rule per (account, event) — POSTing an event that already has a
// rule updates it in place (upsert), so "repeat for every event you
// want to notify on" (docs/ecommerce-integration.md §2) is safe to
// re-run without a prior DELETE.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  NOTIFICATION_RULE_PUBLIC_COLUMNS,
  serializeNotificationRule,
  normalizeNotificationEvent,
  normalizeTemplateName,
  normalizeTemplateLanguage,
  normalizeParamMapping,
} from '@/lib/ecommerce/notification-rules';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'notifications:manage');

    const { data, error } = await ctx.supabase
      .from('notification_rules')
      .select(NOTIFICATION_RULE_PUBLIC_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api/v1/notification-rules] list error:', error);
      return fail('internal', 'Failed to list notification rules', 500);
    }

    return okList(
      (data ?? []).map((r) =>
        serializeNotificationRule(r as Record<string, unknown>)
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

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const event = normalizeNotificationEvent(body.event);
    if (!event) {
      return fail(
        'bad_request',
        "'event' must be one of the known notification events",
        400
      );
    }

    const templateName = normalizeTemplateName(body.template_name);
    if (!templateName) {
      return fail('bad_request', "'template_name' is required", 400);
    }

    const templateLanguage = normalizeTemplateLanguage(body.template_language);
    if (!templateLanguage) {
      return fail(
        'bad_request',
        "'template_language' must be a non-empty string",
        400
      );
    }

    const paramMapping = normalizeParamMapping(body.param_mapping);
    if (!paramMapping) {
      return fail(
        'bad_request',
        "'param_mapping' must be an array of non-empty dot-path strings",
        400
      );
    }

    const { data: upserted, error } = await ctx.supabase
      .from('notification_rules')
      .upsert(
        {
          account_id: ctx.accountId,
          created_by: ctx.createdBy,
          event,
          template_name: templateName,
          template_language: templateLanguage,
          param_mapping: paramMapping,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id,event' }
      )
      .select(NOTIFICATION_RULE_PUBLIC_COLUMNS)
      .single();

    if (error || !upserted) {
      console.error('[api/v1/notification-rules] create error:', error);
      return fail('internal', 'Failed to create notification rule', 500);
    }

    return ok(
      serializeNotificationRule(upserted as Record<string, unknown>),
      201
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
