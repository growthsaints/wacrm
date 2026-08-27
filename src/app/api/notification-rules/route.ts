// ============================================================
// GET  /api/notification-rules — list this account's event → template
//      mappings (dashboard-session equivalent of
//      GET /api/v1/notification-rules, for the Settings UI).
// POST /api/notification-rules — create a mapping for one event.
//
// RLS (migration 066) already restricts insert/update/delete to
// admin+ and lets any member select — this route mirrors the public
// API's validation (lib/notifications/rules.ts) so a dashboard admin
// gets the same "which fields are wrong" feedback a `/api/v1` caller
// would, without needing an API key.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { isNotificationEvent } from '@/lib/notifications/events';
import {
  NOTIFICATION_RULE_COLUMNS,
  serializeNotificationRule,
  normalizeParamMapping,
} from '@/lib/notifications/rules';

/** Postgres unique_violation — thrown by the (account_id, event) index. */
const UNIQUE_VIOLATION = '23505';

export async function GET() {
  try {
    const { supabase } = await getCurrentAccount();

    // RLS (notification_rules_select) scopes this to the caller's account.
    const { data, error } = await supabase
      .from('notification_rules')
      .select(NOTIFICATION_RULE_COLUMNS)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      rules: (data ?? []).map((r) => serializeNotificationRule(r as Record<string, unknown>)),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }

    const event = typeof body.event === 'string' ? body.event.trim() : '';
    if (!isNotificationEvent(event)) {
      return NextResponse.json(
        { error: "'event' must be one of the known notification events" },
        { status: 400 },
      );
    }

    const templateName = typeof body.template_name === 'string' ? body.template_name.trim() : '';
    if (!templateName) {
      return NextResponse.json({ error: "'template_name' is required" }, { status: 400 });
    }

    const templateLanguage =
      typeof body.template_language === 'string' && body.template_language.trim()
        ? body.template_language.trim()
        : 'en';

    const paramMapping = normalizeParamMapping(body.param_mapping);
    if (paramMapping === null) {
      return NextResponse.json(
        { error: "'param_mapping' must be an array of non-empty dot-path strings" },
        { status: 400 },
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
        return NextResponse.json(
          { error: `A rule for event "${event}" already exists — edit it instead of creating a new one` },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      { rule: serializeNotificationRule(created as Record<string, unknown>) },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
