import type { SupabaseClient } from '@supabase/supabase-js';

export class HttpSmsConversationError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpSmsConversationError';
    this.status = status;
  }
}

/**
 * Find (or create) this contact's httpSMS conversation. V1 supports
 * one connected httpSMS phone number per account (no round-robin like
 * SMS Gateway's multi-device — see lib/sms/device-assignment.ts) so
 * there's nothing to pick between yet; a new conversation is always
 * pinned to that single enabled config. An existing conversation keeps
 * whatever config it was first pinned to, same reasoning as every
 * other channel: replies must keep coming from the same number.
 */
export async function resolveHttpSmsConversation(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  contactId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', 'httpsms')
    .maybeSingle();

  if (existing) return existing.id as string;

  const { data: config } = await supabase
    .from('httpsms_config')
    .select('id')
    .eq('account_id', accountId)
    .eq('enabled', true)
    .limit(1)
    .maybeSingle();

  if (!config) {
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
      httpsms_config_id: config.id,
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
