import type { SupabaseClient } from '@supabase/supabase-js';

export interface HttpSmsNumberLoad {
  id: string;
  label: string;
  phoneNumber: string;
  conversationCount: number;
}

/**
 * Every enabled httpSMS number on the account, with how many
 * conversations are currently pinned to it. Unlike the SMS Gateway
 * integration's per-device daily cap (lib/sms/device-assignment.ts),
 * httpSMS has no wacrm-side capacity limit to track — the platform
 * paces/rate-limits sends per phone on its own side (Settings →
 * Control SMS Send Rate on httpsms.com). Conversation count is just a
 * simple, cheap load-balance signal: spread new customers across
 * connected numbers rather than always picking the same one.
 */
export async function listEnabledHttpSmsNumbers(
  supabase: SupabaseClient,
  accountId: string,
): Promise<HttpSmsNumberLoad[]> {
  const { data: configs, error } = await supabase
    .from('httpsms_config')
    .select('id, label, phone_number')
    .eq('account_id', accountId)
    .eq('enabled', true);
  if (error) throw new Error(`Could not load httpSMS numbers: ${error.message}`);
  if (!configs || configs.length === 0) return [];

  return Promise.all(
    configs.map(async (c) => {
      const { count } = await supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('httpsms_config_id', c.id);
      return {
        id: c.id as string,
        label: (c.label as string) ?? 'httpSMS',
        phoneNumber: c.phone_number as string,
        conversationCount: count ?? 0,
      };
    }),
  );
}

/** Fewest existing conversations wins — self-balancing, no persisted
 *  "last used" pointer needed, same reasoning as the SMS Gateway
 *  integration's pickLeastLoadedDevice. */
export function pickLeastLoadedHttpSmsNumber(numbers: HttpSmsNumberLoad[]): HttpSmsNumberLoad | null {
  if (numbers.length === 0) return null;
  return numbers.reduce((best, n) => (n.conversationCount < best.conversationCount ? n : best));
}
