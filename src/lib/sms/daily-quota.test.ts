import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { countRecentSmsSent, SMS_DAILY_CAP } from './daily-quota';

function makeDb(result: { count: number | null; error: { message: string } | null }) {
  const gte = vi.fn(async () => result);
  const eq2 = vi.fn(() => ({ gte }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ select }));
  return { from } as unknown as SupabaseClient;
}

describe('countRecentSmsSent', () => {
  it('returns the count from the last 24h of agent-sent SMS messages', async () => {
    const db = makeDb({ count: 42, error: null });
    await expect(countRecentSmsSent(db)).resolves.toBe(42);
  });

  it('returns 0 when count is null', async () => {
    const db = makeDb({ count: null, error: null });
    await expect(countRecentSmsSent(db)).resolves.toBe(0);
  });

  it('throws when the query fails', async () => {
    const db = makeDb({ count: null, error: { message: 'db down' } });
    await expect(countRecentSmsSent(db)).rejects.toThrow(/db down/);
  });
});

describe('SMS_DAILY_CAP', () => {
  it('is 100', () => {
    expect(SMS_DAILY_CAP).toBe(100);
  });
});
