import type { SupabaseClient } from '@supabase/supabase-js';
import { listEnabledHttpSmsNumbers, pickLeastLoadedHttpSmsNumber } from '@/lib/httpsms/device-assignment';

export class HttpSmsConversationError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpSmsConversationError';
    this.status = status;
  }
}

/**
 * Find (or create) this contact's httpSMS conversation, assigning a
 * number via round-robin only when actually creating one — an
 * existing conversation keeps whatever number it was first pinned to
 * (replies must keep coming from the same number the customer already
 * saw). Mirrors lib/sms/conversation.ts's resolveSmsConversation.
 *
 * preferredConfigId (bulk-broadcast wizard's "send from" picker):
 * when set, a NEW conversation is pinned to that specific number
 * instead of round-robin; if it's disabled or gone this throws rather
 * than silently falling back, since picking one on purpose implies
 * caring which number the campaign goes out from. Omit for the
 * default round-robin behavior.
 */
export async function resolveHttpSmsConversation(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  contactId: string,
  preferredConfigId?: string | null,
): Promise<string> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', 'httpsms')
    .maybeSingle();

  if (existing) return existing.id as string;

  const numbers = await listEnabledHttpSmsNumbers(supabase, accountId);
  const chosen = preferredConfigId
    ? numbers.find((n) => n.id === preferredConfigId)
    : pickLeastLoadedHttpSmsNumber(numbers);

  if (!chosen) {
    if (preferredConfigId) {
      throw new HttpSmsConversationError('The selected httpSMS number is no longer connected or enabled.', 400);
    }
    throw new HttpSmsConversationError(
      'No enabled httpSMS number connected. Connect one in Settings → httpSMS.',
      400,
    );
  }

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
      channel: 'httpsms',
      httpsms_config_id: chosen.id,
    })
    .select('id')
    .single();

  if (error || !created) {
    // Lost a race with a concurrent create for the same contact — same
    // re-resolve-the-winner pattern used throughout this codebase.
    const { data: raced } = await supabase
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('channel', 'httpsms')
      .maybeSingle();
    if (raced) return raced.id as string;
    throw new HttpSmsConversationError('Failed to open an httpSMS conversation for this contact', 500);
  }

  return created.id as string;
}
