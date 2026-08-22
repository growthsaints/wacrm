// ============================================================
// Idempotency-key handling for public API POST endpoints (Ecommerce
// Notification Integration spec, Phase 1) — extracted out of the
// route handler so the reserve/replay/release logic is unit-testable
// without mocking `Request`/`NextResponse`, matching this repo's
// convention of thin routes + tested `lib/` (see AGENTS.md).
//
// Backed by `message_send_idempotency` (migration 065). Usage:
//
//   const reservation = await reserveIdempotencyKey(db, accountId, key);
//   if (reservation.status === 'replay') return ok(reservation.responseBody, 201);
//   if (reservation.status === 'in_progress') return fail(...);
//   // reservation.status === 'reserved' (or 'skipped' — no key given)
//   ... do the side-effecting work ...
//   await fillIdempotencyKey(db, accountId, key, responseData);
//   // on failure instead:
//   await releaseIdempotencyKey(db, accountId, key);
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Extract a caller-supplied idempotency key: the `Idempotency-Key`
 * header takes precedence over an `idempotency_key` body field, so a
 * caller that sets both (a generic HTTP client wrapper plus a manual
 * retry helper) gets one unambiguous behaviour. Shared by every
 * public-API POST that accepts a key (`/api/v1/messages` and the
 * ecommerce/payment/shipping notification receivers).
 */
export function extractIdempotencyKey(
  request: Request,
  body: Record<string, unknown> | null
): string | null {
  const header = request.headers.get('idempotency-key')?.trim();
  if (header) return header;
  const fromBody =
    body && typeof body.idempotency_key === 'string'
      ? body.idempotency_key.trim()
      : '';
  return fromBody || null;
}

export type IdempotencyReservation =
  | { status: 'skipped' } // no key was given — nothing to do
  | { status: 'reserved' } // this call owns the key; proceed and fill it in
  | { status: 'replay'; responseBody: unknown } // a prior call already completed — replay its response
  | { status: 'in_progress' }; // a concurrent call reserved the key but hasn't filled it in yet

/**
 * Reserve `key` for `accountId` before doing any side-effecting work.
 * Insert-first (not check-then-insert) so two concurrent requests for
 * the same key race on the table's UNIQUE constraint instead of both
 * sailing past a SELECT and double-sending.
 */
export async function reserveIdempotencyKey(
  db: SupabaseClient,
  accountId: string,
  key: string | null
): Promise<IdempotencyReservation> {
  if (!key) return { status: 'skipped' };

  const { error: reserveError } = await db
    .from('message_send_idempotency')
    .insert({ account_id: accountId, idempotency_key: key, response_body: null });

  if (!reserveError) return { status: 'reserved' };

  if (reserveError.code !== UNIQUE_VIOLATION) {
    // Non-critical bookkeeping failure (DB hiccup) — log and let the
    // caller proceed without idempotency protection for this request
    // rather than blocking the send entirely.
    console.error(
      '[idempotency] failed to reserve key:',
      reserveError.message
    );
    return { status: 'skipped' };
  }

  const { data: existing } = await db
    .from('message_send_idempotency')
    .select('response_body')
    .eq('account_id', accountId)
    .eq('idempotency_key', key)
    .maybeSingle();

  if (existing?.response_body) {
    return { status: 'replay', responseBody: existing.response_body };
  }
  return { status: 'in_progress' };
}

/** Fill in the reserved row once the work it guards has succeeded. */
export async function fillIdempotencyKey(
  db: SupabaseClient,
  accountId: string,
  key: string,
  responseBody: unknown,
  messageId?: string | null
): Promise<void> {
  const { error } = await db
    .from('message_send_idempotency')
    .update({ response_body: responseBody, message_id: messageId ?? null })
    .eq('account_id', accountId)
    .eq('idempotency_key', key);
  if (error) {
    console.error('[idempotency] failed to fill in key:', error.message);
  }
}

/**
 * Release a reservation whose guarded work failed, so a genuine retry
 * isn't stuck behind a NULL `response_body` forever. The `is('response_body', null)`
 * guard avoids deleting a row a *different* concurrent request already
 * filled in between our reservation and this failure.
 */
export async function releaseIdempotencyKey(
  db: SupabaseClient,
  accountId: string,
  key: string
): Promise<void> {
  const { error } = await db
    .from('message_send_idempotency')
    .delete()
    .eq('account_id', accountId)
    .eq('idempotency_key', key)
    .is('response_body', null);
  if (error) {
    console.error('[idempotency] failed to release key:', error.message);
  }
}
