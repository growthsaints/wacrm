import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { countRecentSmsSentByDevice, SMS_DAILY_CAP } from './daily-quota';

function makeDb(result: { count: number | null; error: { message: string } | null }) {
  const gte = vi.fn(async () => result);
  const eq3 = vi.fn(() => ({ gte }));
  const eq2 = vi.fn(() => ({ eq: eq3 }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ select }));
  return { from } as unknown as SupabaseClient;
}

describe('countRecentSmsSentByDevice', () => {
  it('returns the count from the last 24h of agent-sent SMS for that device', async () => {
    const db = makeDb({ count: 42, error: null });
    await expect(countRecentSmsSentByDevice(db, 'dev-1')).resolves.toBe(42);
  });

  it('returns 0 when count is null', async () => {
    const db = makeDb({ count: null, error: null });
    await expect(countRecentSmsSentByDevice(db, 'dev-1')).resolves.toBe(0);
  });

  it('throws when the query fails', async () => {
    const db = makeDb({ count: null, error: { message: 'db down' } });
    await expect(countRecentSmsSentByDevice(db, 'dev-1')).rejects.toThrow(/db down/);
  });
});

describe('SMS_DAILY_CAP', () => {
  it('is 100', () => {
    expect(SMS_DAILY_CAP).toBe(100);
  });
});
