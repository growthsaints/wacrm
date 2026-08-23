import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api';

const RATING_RANK: Record<string, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

/**
 * True only when `next` is a strictly worse rating than `previous` —
 * RED → YELLOW (recovering) or YELLOW → YELLOW (unchanged) don't count,
 * so the account owner isn't alerted about improvement or noise. A null
 * `previous` (never synced before) counts as a worsening only if `next`
 * itself isn't Green, since there's no real baseline to compare against.
 */
export function hasQualityRatingWorsened(previous: string | null, next: string | null): boolean {
  if (!next || !(next in RATING_RANK)) return false;
  if (!previous || !(previous in RATING_RANK)) return RATING_RANK[next] > 0;
  return RATING_RANK[next] > RATING_RANK[previous];
}

/**
 * Handles Meta's `phone_number_quality_update` webhook field for one
 * account: re-fetches the number's live quality rating via the Graph
 * API (the same trusted `verifyPhoneNumber` call the "Refresh Status"
 * button already uses) instead of trusting the webhook payload's own
 * shape — this codebase's webhook comments explicitly flag that shape
 * as unverified. Updates the cached `whatsapp_config` columns, and only
 * when the rating has genuinely worsened, notifies the account owner
 * directly (not just a platform-admin-reviewed log row), since most
 * accounts don't have the opt-in Campaign Intelligence module that
 * would otherwise surface this.
 *
 * Best-effort: any failure (missing config, undecryptable token, Meta
 * API error) is swallowed and logged — this runs from the webhook's
 * `after()` callback, after Meta has already been ack'd, so there's
 * nothing to return an error to.
 */
export async function handleQualityRatingChange(db: SupabaseClient, accountId: string): Promise<void> {
  try {
    const { data: config, error } = await db
      .from('whatsapp_config')
      .select('phone_number_id, access_token, quality_rating')
      .eq('account_id', accountId)
      .maybeSingle();
    const row = config as
      | { phone_number_id?: string | null; access_token?: string | null; quality_rating?: string | null }
      | null;
    if (error || !row?.phone_number_id || !row.access_token) return;

    const previousRating = row.quality_rating ?? null;

    let accessToken: string;
    try {
      accessToken = decrypt(row.access_token);
    } catch {
      return;
    }

    const phoneInfo = await verifyPhoneNumber({ phoneNumberId: row.phone_number_id, accessToken });
    const newRating = phoneInfo.quality_rating ?? null;

    const nowIso = new Date().toISOString();
    await db
      .from('whatsapp_config')
      .update({
        quality_rating: newRating,
        messaging_limit_tier: phoneInfo.whatsapp_business_manager_messaging_limit ?? null,
        last_synced_at: nowIso,
        updated_at: nowIso,
      })
      .eq('account_id', accountId);

    if (hasQualityRatingWorsened(previousRating, newRating)) {
      await notifyAccountOwnerOfQualityDrop(db, accountId, newRating as string);
    }
  } catch (err) {
    console.error(
      '[quality-alert] handleQualityRatingChange threw:',
      err instanceof Error ? err.message : err
    );
  }
}

async function notifyAccountOwnerOfQualityDrop(
  db: SupabaseClient,
  accountId: string,
  newRating: string
): Promise<void> {
  const { data: account } = await db
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle();
  const ownerUserId = (account as { owner_user_id?: string | null } | null)?.owner_user_id;
  if (!ownerUserId) return;

  const label = newRating === 'RED' ? 'Red' : 'Yellow';
  const body =
    newRating === 'RED'
      ? 'Meta has flagged your number at Red quality — broadcasts are now paused automatically to protect it. Review recent templates and only message contacts who opted in.'
      : 'Meta has flagged your number at Yellow quality. Slow down send volume — check Compliance Center (if enabled) for recommendations.';

  const { error } = await db.from('notifications').insert({
    account_id: accountId,
    user_id: ownerUserId,
    type: 'quality_rating_changed',
    title: `WhatsApp quality rating dropped to ${label}`,
    body,
  });
  if (error) {
    console.error('[quality-alert] failed to notify account owner:', error.message);
  }
}
