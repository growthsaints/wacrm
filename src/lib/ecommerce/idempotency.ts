// ============================================================
// Idempotency ledger for ecommerce notification receivers.
//
// Claim-first: insert a 'processing' row *before* any side effect
// (sending a WhatsApp message) runs. The UNIQUE(account_id,
// idempotency_key) index (migration 037) is what makes a concurrent
// duplicate call fail the insert instead of racing a double-send.
//
// Used by:
//   - POST /api/v1/ecommerce/webhook, keyed by the caller's
//     `Idempotency-Key` header (documented, optional).
//   - The Razorpay receiver, keyed by `payment.entity.id` + event —
//     Razorpay retries a webhook delivery until it gets a 2xx, so
//     without this a retry would send a second WhatsApp message.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export type IdempotencyClaim =
  | { outcome: 'claimed'; id: string }
  | { outcome: 'in_progress' }
  | { outcome: 'replay'; status: number; body: unknown };

/**
 * Attempt to claim `key` for `accountId`. Returns:
 *   - `claimed`    — this call owns the key; proceed, then call
 *                    `completeIdempotencyKey` with the row id.
 *   - `in_progress`— another call with the same key is mid-flight.
 *   - `replay`     — a prior call already completed; replay its
 *                    stored response rather than re-sending.
 */
export async function claimIdempotencyKey(
  db: SupabaseClient,
  accountId: string,
  key: string
): Promise<IdempotencyClaim> {
  const { data: inserted, error: insertError } = await db
    .from('ecommerce_webhook_events')
    .insert({ account_id: accountId, idempotency_key: key })
    .select('id')
    .maybeSingle();

  if (!insertError && inserted) {
    return { outcome: 'claimed', id: inserted.id as string };
  }

  // Anything other than the unique-violation we expect on a
  // concurrent/retried call is a real DB error — surface it as
  // "in_progress" so the caller 409s rather than silently proceeding
  // without an idempotency guarantee.
  if (insertError && insertError.code !== '23505') {
    console.error('[ecommerce/idempotency] claim insert error:', insertError);
    return { outcome: 'in_progress' };
  }

  const { data: existing, error: fetchError } = await db
    .from('ecommerce_webhook_events')
    .select('status, response_status, response_body')
    .eq('account_id', accountId)
    .eq('idempotency_key', key)
    .maybeSingle();

  if (fetchError || !existing) {
    // Lost the row between the conflict and this read — treat as
    // in-progress rather than risk a second side effect.
    return { outcome: 'in_progress' };
  }

  if (existing.status === 'processing') {
    return { outcome: 'in_progress' };
  }

  return {
    outcome: 'replay',
    status: (existing.response_status as number | null) ?? 200,
    body: existing.response_body,
  };
}

/** Record the outcome of a claimed key so a future retry can replay it. */
export async function completeIdempotencyKey(
  db: SupabaseClient,
  id: string,
  status: 'done' | 'failed',
  responseStatus: number,
  responseBody: unknown
): Promise<void> {
  const { error } = await db
    .from('ecommerce_webhook_events')
    .update({
      status,
      response_status: responseStatus,
      response_body: responseBody,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) {
    console.error('[ecommerce/idempotency] complete update failed:', error);
  }
}
