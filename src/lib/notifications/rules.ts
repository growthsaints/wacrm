// ============================================================
// notification_rules (migration 066) — lookup + param-mapping
// resolution. Shared by the ecommerce/payment/shipping receivers
// (Phase 2a/2b/2c): each one normalizes its own webhook payload into
// a flat `data` object, looks up the rule for its event, and asks
// this module to fill in the template's positional body params.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export interface NotificationRule {
  id: string;
  event: string;
  templateName: string;
  templateLanguage: string;
  paramMapping: string[];
}

/** Columns safe to return over the API — the whole row, nothing sensitive here. */
export const NOTIFICATION_RULE_COLUMNS =
  'id, event, template_name, template_language, param_mapping, is_active, created_at';

export interface ApiNotificationRule {
  id: string;
  event: string;
  template_name: string;
  template_language: string;
  param_mapping: string[];
  is_active: boolean;
  created_at: string;
}

/** Project a `NOTIFICATION_RULE_COLUMNS` row into the API shape. */
export function serializeNotificationRule(
  row: Record<string, unknown>
): ApiNotificationRule {
  return {
    id: row.id as string,
    event: row.event as string,
    template_name: row.template_name as string,
    template_language: row.template_language as string,
    param_mapping: Array.isArray(row.param_mapping)
      ? (row.param_mapping as unknown[]).filter(
          (p): p is string => typeof p === 'string'
        )
      : [],
    is_active: Boolean(row.is_active),
    created_at: row.created_at as string,
  };
}

/** Validate a caller-supplied `param_mapping`: an array of non-empty dot-path strings. */
export function normalizeParamMapping(input: unknown): string[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return null;
  const out: string[] = [];
  for (const entry of input) {
    if (typeof entry !== 'string' || !entry.trim()) return null;
    out.push(entry.trim());
  }
  return out;
}

/**
 * Look up the active rule for `event` on this account. Returns null
 * if none is configured or it's been disabled — callers should treat
 * that as "nothing to send" (log + 200), not an error, since a
 * receiver's whole point is working out of the box for events an
 * account hasn't bothered to configure a template for yet.
 */
export async function findActiveNotificationRule(
  db: SupabaseClient,
  accountId: string,
  event: string
): Promise<NotificationRule | null> {
  const { data, error } = await db
    .from('notification_rules')
    .select('id, event, template_name, template_language, param_mapping, is_active')
    .eq('account_id', accountId)
    .eq('event', event)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error('[notifications] rule lookup failed:', error.message);
    return null;
  }
  if (!data) return null;

  return {
    id: data.id as string,
    event: data.event as string,
    templateName: data.template_name as string,
    templateLanguage: (data.template_language as string) || 'en',
    paramMapping: Array.isArray(data.param_mapping)
      ? (data.param_mapping as unknown[]).filter(
          (p): p is string => typeof p === 'string'
        )
      : [],
  };
}

/**
 * Resolve a single dot-path (`"order.total"`, `"customer.name"`)
 * against a nested object. No array-index syntax — the receivers'
 * normalized `data` shapes are flat-ish records, not arrays-of-arrays
 * — an unresolvable path (typo'd mapping, missing optional field)
 * yields `''` rather than throwing, since a missing variable
 * shouldn't break the whole notification.
 */
function getPath(data: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[part];
  }
  if (current === null || current === undefined) return '';
  return String(current);
}

/**
 * Build the template's ordered positional body params from a rule's
 * `paramMapping` and the receiver's normalized event `data`.
 */
export function resolveTemplateParams(
  paramMapping: string[],
  data: Record<string, unknown>
): string[] {
  return paramMapping.map((path) => getPath(data, path));
}
