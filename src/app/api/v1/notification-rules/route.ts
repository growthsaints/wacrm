// ============================================================
// GET  /api/v1/notification-rules — list an account's event → template
//      mappings                                  (notifications:manage)
// POST /api/v1/notification-rules — create/replace a mapping for one
//      event                                     (notifications:manage)
//
// Backs Phase 2a/2b/2c's generic ecommerce/payment/shipping receivers:
// an admin configures "when X happens, send template Y" here, once per
// event, entirely through this API — onboarding a new client never
// requires a code change, only a rule (see `NOTIFICATION_EVENTS` in
// lib/notifications/events.ts for the fixed event vocabulary).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { isNotificationEvent } from '@/lib/notifications/events';
import {
  NOTIFICATION_RULE_COLUMNS,
  serializeNotificationRule,
  normalizeParamMapping,
} from '@/lib/notifications/rules';

/** Postgres unique_violation — thrown by the (account_id, event) index. */
const UNIQUE_VIOLATION = '23505';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'notifications:manage');

    const { data, error } = await ctx.supabase
      .from('notification_rules')
      .select(NOTIFICATION_RULE_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api/v1/notification-rules] list error:', error);
      return fail('internal', 'Failed to list notification rules', 500);
    }

    // Settings-class, small roster — return it whole, same as /webhooks.
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

    const event = typeof body.event === 'string' ? body.event.trim() : '';
    if (!isNotificationEvent(event)) {
      return fail(
        'bad_request',
        `'event' must be one of the known notification events`,
        400
      );
    }

    const templateName =
      typeof body.template_name === 'string' ? body.template_name.trim() : '';
    if (!templateName) {
      return fail('bad_request', "'template_name' is required", 400);
    }

    const templateLanguage =
      typeof body.template_language === 'string' && body.template_language.trim()
        ? body.template_language.trim()
        : 'en';

    const paramMapping = normalizeParamMapping(body.param_mapping);
    if (paramMapping === null) {
      return fail(
        'bad_request',
        "'param_mapping' must be an array of non-empty dot-path strings",
        400
      );
    }

    const { data: created, error } = await ctx.supabase
      .from('notification_rules')
      .insert({
        account_id: ctx.accountId,
        event,
        template_name: templateName,
        template_language: templateLanguage,
        param_mapping: paramMapping,
      })
      .select(NOTIFICATION_RULE_COLUMNS)
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return fail(
          'bad_request',
          `A rule for event "${event}" already exists — use PATCH /api/v1/notification-rules/{id} to update it`,
          409
        );
      }
      console.error('[api/v1/notification-rules] create error:', error);
      return fail('internal', 'Failed to create notification rule', 500);
    }

    return ok(serializeNotificationRule(created as Record<string, unknown>), 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
