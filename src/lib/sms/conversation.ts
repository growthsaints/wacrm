import type { SupabaseClient } from '@supabase/supabase-js';
import { listEnabledDevicesWithCapacity, pickLeastLoadedDevice } from '@/lib/sms/device-assignment';

export class SmsConversationError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SmsConversationError';
    this.status = status;
  }
}

/**
 * Find (or create) this contact's SMS conversation, assigning a device
 * only when actually creating one — an existing conversation keeps
 * whatever device it was first pinned to (a manual preferredDeviceId
 * never moves an existing conversation, same reasoning as everywhere
 * else pinning applies: the customer already sees replies from that
 * number). Shared by the interactive dashboard send route and the
 * bulk-broadcast send route so both apply identical device-assignment
 * rules rather than a second, drifting copy (see migration 080 /
 * device-assignment.ts for why pinning matters).
 *
 * preferredDeviceId (bulk-broadcast wizard's "send from" picker):
 * when set, a NEW conversation is pinned to that specific device
 * instead of round-robin — and only that device; if it's disabled or
 * at its cap this throws rather than silently spilling onto another
 * device, since the whole point of picking one was to control which
 * number the campaign goes out from. Omit it (or leave unset) for the
 * default round-robin behavior.
 */
export async function resolveSmsConversation(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  contactId: string,
  preferredDeviceId?: string | null,
): Promise<string> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', 'sms')
    .maybeSingle();

  if (existing) return existing.id as string;

  const devices = await listEnabledDevicesWithCapacity(supabase, accountId);
  const chosen = preferredDeviceId
    ? devices.find((d) => d.id === preferredDeviceId && d.remaining > 0)
    : pickLeastLoadedDevice(devices);
  if (!chosen) {
    if (preferredDeviceId) {
      const exists = devices.some((d) => d.id === preferredDeviceId);
      throw new SmsConversationError(
        exists
          ? 'The selected SMS device has reached its daily limit — pick a different device or try again after it resets.'
          : 'The selected SMS device is no longer connected or enabled.',
        exists ? 429 : 400,
      );
    }
    throw new SmsConversationError(
      devices.length === 0
        ? 'No enabled SMS gateway device found. Connect (or re-enable) one in Settings → SMS.'
        : 'Every connected SMS device has reached its daily limit — try again after it resets.',
      devices.length === 0 ? 400 : 429
    );
  }

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
      channel: 'sms',
      sms_config_id: chosen.id,
    })
    .select('id')
    .single();

  if (error || !created) {
    // Lost a race with a concurrent create for the same contact (e.g.
    // two broadcast batches hitting the same contact) — re-resolve the
    // winning row rather than erroring, same pattern used throughout
    // this codebase's contact/conversation creation paths.
    const { data: raced } = await supabase
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('channel', 'sms')
      .maybeSingle();
    if (raced) return raced.id as string;
    throw new SmsConversationError('Failed to open an SMS conversation for this contact', 500);
  }

  return created.id as string;
}
