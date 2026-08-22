// ============================================================
// notification_rules store helpers — validation + serialization for
// the public API (POST/GET/PATCH/DELETE /api/v1/notification-rules).
// ============================================================

import { isNotificationEvent, type NotificationEvent } from './events';

export const NOTIFICATION_RULE_PUBLIC_COLUMNS =
  'id, event, template_name, template_language, param_mapping, created_at, updated_at';

export interface ApiNotificationRule {
  id: string;
  event: NotificationEvent;
  template_name: string;
  template_language: string;
  param_mapping: string[];
  created_at: string;
  updated_at: string;
}

export function serializeNotificationRule(
  row: Record<string, unknown>
): ApiNotificationRule {
  return {
    id: row.id as string,
    event: row.event as NotificationEvent,
    template_name: row.template_name as string,
    template_language: row.template_language as string,
    param_mapping: (row.param_mapping as string[] | null) ?? [],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/** Validate the `event` field against the full notification vocabulary. */
export function normalizeNotificationEvent(
  input: unknown
): NotificationEvent | null {
  return isNotificationEvent(input) ? input : null;
}

/** Non-empty template name, trimmed. */
export function normalizeTemplateName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Template language, defaulting to 'en_US' when omitted (matches messages route). */
export function normalizeTemplateLanguage(input: unknown): string | null {
  if (input === undefined || input === null) return 'en_US';
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * `param_mapping` is an ordered array of dot-paths (may be empty, for
 * a template with no variables). Returns null if any entry isn't a
 * non-empty string.
 */
export function normalizeParamMapping(input: unknown): string[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return null;
  const out: string[] = [];
  for (const entry of input) {
    if (typeof entry !== 'string' || entry.trim().length === 0) return null;
    out.push(entry.trim());
  }
  return out;
}
