// ============================================================
// notification_send_logs (migration 069) — best-effort observability
// for the three notification receivers. Never throws: a logging
// failure must not fail (or retry-loop) the webhook it's observing —
// same posture as `lib/commerce/notify.ts`'s `notifyOrderStatus`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export type NotificationLogSource = 'ecommerce' | 'payment' | 'shipping';
export type NotificationLogStatus = 'sent' | 'replayed' | 'skipped' | 'failed';

export interface LogNotificationSendParams {
  accountId: string;
  source: NotificationLogSource;
  event: string;
  phone?: string | null;
  templateName?: string | null;
  status: NotificationLogStatus;
  reason?: string | null;
}

export async function logNotificationSend(
  db: SupabaseClient,
  params: LogNotificationSendParams
): Promise<void> {
  try {
    const { error } = await db.from('notification_send_logs').insert({
      account_id: params.accountId,
      source: params.source,
      event: params.event,
      phone: params.phone ?? null,
      template_name: params.templateName ?? null,
      status: params.status,
      reason: params.reason ?? null,
    });
    if (error) {
      console.error('[notifications] failed to write send log:', error.message);
    }
  } catch (err) {
    console.error('[notifications] failed to write send log:', err);
  }
}
