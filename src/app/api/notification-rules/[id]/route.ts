// ============================================================
// PATCH  /api/notification-rules/{id} — update template/mapping/is_active
// DELETE /api/notification-rules/{id} — remove a rule
//
// Dashboard-session equivalent of the /api/v1/notification-rules/{id}
// routes — see that file for the shared validation this mirrors.
// account-scoped: a foreign id 404s (RLS + the explicit account_id
// filter both enforce this).
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { NOTIFICATION_RULE_COLUMNS, serializeNotificationRule, normalizeParamMapping } from '@/lib/notifications/rules';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};

    if ('template_name' in body) {
      const name = typeof body.template_name === 'string' ? body.template_name.trim() : '';
      if (!name) {
        return NextResponse.json({ error: "'template_name' cannot be empty" }, { status: 400 });
      }
      updates.template_name = name;
    }

    if ('template_language' in body) {
      const lang = typeof body.template_language === 'string' ? body.template_language.trim() : '';
      if (!lang) {
        return NextResponse.json({ error: "'template_language' cannot be empty" }, { status: 400 });
      }
      updates.template_language = lang;
    }

    if ('param_mapping' in body) {
      const mapping = normalizeParamMapping(body.param_mapping);
      if (mapping === null) {
        return NextResponse.json(
          { error: "'param_mapping' must be an array of non-empty dot-path strings" },
          { status: 400 },
        );
      }
      updates.param_mapping = mapping;
    }

    if ('is_active' in body) {
      if (typeof body.is_active !== 'boolean') {
        return NextResponse.json({ error: "'is_active' must be a boolean" }, { status: 400 });
      }
      updates.is_active = body.is_active;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('notification_rules')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(NOTIFICATION_RULE_COLUMNS)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Notification rule not found' }, { status: 404 });

    return NextResponse.json({ rule: serializeNotificationRule(data as Record<string, unknown>) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('notification_rules')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Notification rule not found' }, { status: 404 });

    return NextResponse.json({ id: data.id, deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
