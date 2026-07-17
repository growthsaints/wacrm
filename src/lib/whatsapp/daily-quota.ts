import type { SupabaseClient } from '@supabase/supabase-js';
import { dailyCapForTier } from './messaging-limit';

export class DailyQuotaError extends Error {
  readonly code = 'daily_quota_exceeded';
  constructor(message: string) {
    super(message);
    this.name = 'DailyQuotaError';
  }
}

const LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Throws {@link DailyQuotaError} if the account has already reached
 * its Meta messaging-limit tier's cap on distinct contacts messaged
 * in the last rolling 24 hours — protects the number from Meta
 * throttling/flagging it for exceeding the tier, which can otherwise
 * cascade into the account getting suspended.
 *
 * No-ops (doesn't throw) if `messaging_limit_tier` hasn't been synced
 * yet or is TIER_UNLIMITED — there's nothing to guard against. Scoped
 * to Broadcasts only (counts `broadcast_recipients`); automation/flow
 * sends aren't counted here.
 */
export async function ensureDailyBroadcastQuota(
  db: SupabaseClient,
  accountId: string
): Promise<void> {
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('messaging_limit_tier')
    .eq('account_id', accountId)
    .maybeSingle();
  if (configError) {
    throw new DailyQuotaError('Could not verify your daily messaging limit before sending.');
  }

  const cap = dailyCapForTier(
    (config as { messaging_limit_tier?: string | null } | null)?.messaging_limit_tier
  );
  if (cap === null) return;

  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const { data: count, error } = await db.rpc('count_recent_business_initiated_contacts', {
    p_account_id: accountId,
    p_since: since,
  });
  if (error) {
    throw new DailyQuotaError('Could not verify your daily messaging limit before sending.');
  }

  if ((count ?? 0) >= cap) {
    throw new DailyQuotaError(
      `Daily messaging limit of ${cap.toLocaleString()} reached for the last 24 hours — further broadcast sends are paused until it resets. This protects your WhatsApp number from being flagged by Meta.`
    );
  }
}
