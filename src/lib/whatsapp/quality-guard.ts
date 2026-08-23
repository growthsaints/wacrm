import type { SupabaseClient } from '@supabase/supabase-js';

export class QualityRatingError extends Error {
  readonly code = 'quality_rating_unsafe';
  constructor(message: string) {
    super(message);
    this.name = 'QualityRatingError';
  }
}

/**
 * Throws {@link QualityRatingError} if the account's WhatsApp number is
 * currently at Meta's `RED` quality rating — the state Meta itself
 * describes as high risk of the number being restricted. Broadcasts are
 * business-initiated, high-volume sends, so this is exactly the traffic
 * that pushes a Red number the rest of the way into a ban; blocking it
 * here protects the number (and the shared Business Portfolio) from a
 * self-inflicted escalation.
 *
 * `YELLOW` is deliberately NOT blocked here — it's a softer signal
 * already surfaced as a recommendation on the Account Health / Compliance
 * Center dashboards ("slow down until it recovers to Green"), not a hard
 * stop. Hard-blocking every Yellow account would make the daily quota
 * and wallet checks redundant with this one and lock out accounts that
 * are recovering fine on their own.
 *
 * No-ops (doesn't throw) if `quality_rating` hasn't been synced yet
 * (null) — there's nothing to guard against until a "Refresh Status" /
 * webhook-triggered sync has actually populated it.
 */
export async function ensureQualityRatingSafe(db: SupabaseClient, accountId: string): Promise<void> {
  const { data: config, error } = await db
    .from('whatsapp_config')
    .select('quality_rating')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    throw new QualityRatingError('Could not verify your WhatsApp quality rating before sending.');
  }

  const qualityRating = (config as { quality_rating?: string | null } | null)?.quality_rating;
  if (qualityRating === 'RED') {
    throw new QualityRatingError(
      'Your WhatsApp number is at Red quality rating — broadcasts are paused to protect it from being restricted. Review recent templates and only message contacts who opted in, then check Compliance Center once it recovers to Yellow/Green.'
    );
  }
}
