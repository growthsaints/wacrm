import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import {
  sendPendingConsentRequests,
  CONSENT_BATCH_DEFAULT_LIMIT,
  CONSENT_BATCH_MAX_LIMIT,
} from '@/lib/contacts/consent-batch';

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * POST /api/contacts/consent/send-batch  (admin+)
 *
 * The ONLY way a consent-request template goes out — always a
 * deliberate, admin-triggered, small batch (never automatic on
 * contact creation; see migration 072). Sends `template_name` to up
 * to `limit` (default 25, max 100) contacts whose `contact_consent`
 * row is still `pending` and has never been asked, oldest first.
 * Call again later to work through the rest of the backlog in
 * further small batches.
 *
 * Body: { "template_name": "ask_consent", "template_language": "en", "limit": 25 }
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(`consent-batch:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return bad('Invalid request body');

    const templateName =
      typeof (body as Record<string, unknown>).template_name === 'string'
        ? ((body as Record<string, unknown>).template_name as string).trim()
        : '';
    if (!templateName) return bad("'template_name' is required");

    const templateLanguage =
      typeof (body as Record<string, unknown>).template_language === 'string'
        ? ((body as Record<string, unknown>).template_language as string).trim()
        : null;

    const rawLimit = Number((body as Record<string, unknown>).limit);
    const batchLimit = Number.isFinite(rawLimit)
      ? Math.min(CONSENT_BATCH_MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
      : CONSENT_BATCH_DEFAULT_LIMIT;

    const result = await sendPendingConsentRequests(supabase, accountId, {
      templateName,
      templateLanguage,
      limit: batchLimit,
    });

    return NextResponse.json({ data: result });
  } catch (err) {
    return toErrorResponse(err);
  }
}
