import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A single SMS Gateway device/SIM has no published send-rate limit the
 * way Meta's messaging-limit tiers do for WhatsApp — but a lone SIM
 * blasting hundreds of texts a day is exactly the pattern carriers
 * throttle or flag as spam. 100/day is a conservative, adjustable
 * starting point until real send volume tells us the actual ceiling.
 */
export const SMS_DAILY_CAP = 100;

const LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Count SMS messages this account has sent (agent-authored, channel
 * 'sms') in the last rolling 24 hours — across both bulk broadcasts and
 * one-off sends (Contact Detail / Inbox), since both draw on the same
 * single SIM. RLS already scopes `messages` to the caller's own
 * account, so no explicit account_id filter is needed here.
 */
export async function countRecentSmsSent(supabase: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'sms')
    .eq('sender_type', 'agent')
    .gte('created_at', since);
  if (error) {
    throw new Error(`Could not verify the daily SMS limit: ${error.message}`);
  }
  return count ?? 0;
}
