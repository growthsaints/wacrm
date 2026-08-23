// ============================================================
// Deliberate, rate-limited consent-request sending — the ONLY way a
// consent-request template ever goes out (never automatic on contact
// creation; see migration 072's design notes). An admin picks a
// template and a small batch size and triggers this by hand, as often
// as they judge safe, keeping outbound volume to numbers who haven't
// engaged yet under deliberate human control rather than an automatic
// blast — the same pattern that risks a WABA/quality-rating
// restriction if done in bulk without consent.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTemplateMessageByPhone } from '@/lib/whatsapp/send-template-by-phone';

export const CONSENT_BATCH_DEFAULT_LIMIT = 25;
export const CONSENT_BATCH_MAX_LIMIT = 100;

export interface SendPendingConsentRequestsParams {
  templateName: string;
  templateLanguage?: string | null;
  /** Defaults to CONSENT_BATCH_DEFAULT_LIMIT; clamped to CONSENT_BATCH_MAX_LIMIT. */
  limit?: number;
}

export interface SendPendingConsentRequestsResult {
  attempted: number;
  sent: number;
  failed: number;
  remainingPending: number;
}

/**
 * Send the consent-request template to up to `limit` contacts whose
 * `contact_consent` row is `pending` and has never had a request sent
 * (`consent_template_sent_at IS NULL`) — the oldest first, so a
 * repeated small batch eventually works through the whole backlog
 * without ever sending more than `limit` in one call.
 */
export async function sendPendingConsentRequests(
  db: SupabaseClient,
  accountId: string,
  params: SendPendingConsentRequestsParams
): Promise<SendPendingConsentRequestsResult> {
  const limit = Math.min(
    Math.max(1, params.limit ?? CONSENT_BATCH_DEFAULT_LIMIT),
    CONSENT_BATCH_MAX_LIMIT
  );

  const { data: rows, error } = await db
    .from('contact_consent')
    .select('id, phone_number')
    .eq('account_id', accountId)
    .eq('consent_status', 'pending')
    .is('consent_template_sent_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[consent-batch] pending lookup failed:', error.message);
    return { attempted: 0, sent: 0, failed: 0, remainingPending: 0 };
  }

  const pending = (rows ?? []) as Array<{ id: string; phone_number: string }>;
  let sent = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      const outcome = await sendTemplateMessageByPhone(db, accountId, {
        to: row.phone_number,
        templateName: params.templateName,
        templateLanguage: params.templateLanguage ?? null,
      });
      if (outcome.status === 'in_progress') {
        failed++;
        continue;
      }
      const { error: markError } = await db
        .from('contact_consent')
        .update({ consent_template_sent_at: new Date().toISOString() })
        .eq('id', row.id);
      if (markError) {
        console.error(
          '[consent-batch] failed to mark consent_template_sent_at:',
          markError.message
        );
      }
      sent++;
    } catch (err) {
      console.error(
        `[consent-batch] send failed for ${row.phone_number}:`,
        err instanceof Error ? err.message : err
      );
      failed++;
    }
  }

  const { count: remainingPending } = await db
    .from('contact_consent')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('consent_status', 'pending')
    .is('consent_template_sent_at', null);

  return {
    attempted: pending.length,
    sent,
    failed,
    remainingPending: remainingPending ?? 0,
  };
}
