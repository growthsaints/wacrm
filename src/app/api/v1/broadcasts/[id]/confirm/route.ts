// ============================================================
// POST /api/v1/broadcasts/{id}/confirm — send the remainder of a
// test-batch-gated broadcast (scope: broadcasts:send).
//
// A broadcast whose audience was large enough to trigger the test-
// batch-first gate (see lib/whatsapp/test-batch.ts) lands at
// `awaiting_confirmation` after its first TEST_BATCH_SIZE recipients
// are sent — this endpoint reviews-then-confirms sending to everyone
// still `pending`. Returns 400 for any other status (nothing to
// confirm, or it's not gated in the first place).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { resumeBroadcastDelivery, BroadcastError } from '@/lib/whatsapp/broadcast-core';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'broadcasts:send');
    const { id } = await params;

    const result = await resumeBroadcastDelivery(ctx.supabase, ctx.accountId, id);

    return ok({ broadcast_id: id, ...result });
  } catch (err) {
    if (err instanceof BroadcastError) {
      return fail(err.code, err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
