import type { SupabaseClient } from '@supabase/supabase-js';
import { countRecentSmsSentByDevice, SMS_DAILY_CAP } from '@/lib/sms/daily-quota';

export interface SmsDeviceCapacity {
  id: string;
  label: string;
  sentToday: number;
  remaining: number;
}

/**
 * Every enabled device on the account, with today's send count and
 * remaining capacity against SMS_DAILY_CAP. The basis for both
 * round-robin new-conversation assignment (pickLeastLoadedDevice) and
 * the "X of Y left today" banner in the bulk-SMS wizard.
 */
export async function listEnabledDevicesWithCapacity(
  supabase: SupabaseClient,
  accountId: string
): Promise<SmsDeviceCapacity[]> {
  const { data: devices, error } = await supabase
    .from('sms_config')
    .select('id, label')
    .eq('account_id', accountId)
    .eq('enabled', true);
  if (error) throw new Error(`Could not load SMS devices: ${error.message}`);
  if (!devices || devices.length === 0) return [];

  return Promise.all(
    devices.map(async (d) => {
      const sentToday = await countRecentSmsSentByDevice(supabase, d.id as string);
      return {
        id: d.id as string,
        label: (d.label as string) ?? 'SMS Gateway',
        sentToday,
        remaining: Math.max(0, SMS_DAILY_CAP - sentToday),
      };
    })
  );
}

/**
 * Round-robin by remaining capacity: the device with the most headroom
 * left today gets the next new conversation. Simpler than a rotating
 * pointer and self-balancing — devices that have sent less today
 * naturally get prioritized without needing to persist any "last used"
 * state. Returns null when every enabled device is at its cap (or none
 * are configured/enabled) — callers surface this as "no device
 * available" rather than silently picking an over-cap one.
 */
export function pickLeastLoadedDevice(devices: SmsDeviceCapacity[]): SmsDeviceCapacity | null {
  const withCapacity = devices.filter((d) => d.remaining > 0);
  if (withCapacity.length === 0) return null;
  return withCapacity.reduce((best, d) => (d.remaining > best.remaining ? d : best));
}
