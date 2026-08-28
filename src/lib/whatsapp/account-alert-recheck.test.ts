import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((v: string) => `decrypted:${v}`),
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  verifyPhoneNumber: vi.fn(),
}));

import { recheckAccountAlert } from './account-alert-recheck';
import { decrypt } from '@/lib/whatsapp/encryption';
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api';

function makeDb(opts: {
  hasUnresolvedFlagged: boolean;
  config?: { phone_number_id?: string | null; access_token?: string | null } | null;
  updateError?: { message: string } | null;
}) {
  const eventsSelectLimit = vi.fn(async () => ({
    data: opts.hasUnresolvedFlagged ? [{ id: 'evt-1' }] : [],
    error: null,
  }));
  const eventsSelectEq3 = vi.fn(() => ({ limit: eventsSelectLimit }));
  const eventsSelectEq2 = vi.fn(() => ({ eq: eventsSelectEq3 }));
  const eventsSelectEq1 = vi.fn(() => ({ eq: eventsSelectEq2 }));
  const eventsSelect = vi.fn(() => ({ eq: eventsSelectEq1 }));

  const updateEq3 = vi.fn(async () => ({ error: opts.updateError ?? null }));
  const updateEq2 = vi.fn(() => ({ eq: updateEq3 }));
  const updateEq1 = vi.fn(() => ({ eq: updateEq2 }));
  const update = vi.fn(() => ({ eq: updateEq1 }));

  const configMaybeSingle = vi.fn(async () => ({
    data: opts.config === undefined ? null : opts.config,
    error: null,
  }));
  const configEq = vi.fn(() => ({ maybeSingle: configMaybeSingle }));
  const configSelect = vi.fn(() => ({ eq: configEq }));

  const from = vi.fn((table: string) => {
    if (table === 'whatsapp_account_events') return { select: eventsSelect, update };
    if (table === 'whatsapp_config') return { select: configSelect };
    throw new Error(`unexpected table: ${table}`);
  });

  return { from, update } as unknown as SupabaseClient & { update: typeof update };
}

describe('recheckAccountAlert', () => {
  beforeEach(() => {
    vi.mocked(verifyPhoneNumber).mockReset();
    vi.mocked(decrypt).mockClear();
  });

  it('skips the Graph API call and returns false when nothing is flagged', async () => {
    const db = makeDb({ hasUnresolvedFlagged: false });

    const result = await recheckAccountAlert(db, 'acct-1');

    expect(result).toBe(false);
    expect(verifyPhoneNumber).not.toHaveBeenCalled();
  });

  it('auto-resolves flagged rows when the live Graph API call succeeds', async () => {
    const db = makeDb({
      hasUnresolvedFlagged: true,
      config: { phone_number_id: 'pnid-1', access_token: 'enc-token' },
    });
    vi.mocked(verifyPhoneNumber).mockResolvedValue({ display_phone_number: '+1' } as never);

    const result = await recheckAccountAlert(db, 'acct-1');

    expect(verifyPhoneNumber).toHaveBeenCalledWith({
      phoneNumberId: 'pnid-1',
      accessToken: 'decrypted:enc-token',
    });
    expect(db.update).toHaveBeenCalledWith({ resolved: true });
    expect(result).toBe(true);
  });

  it('leaves rows flagged when the Graph API call fails (still restricted)', async () => {
    const db = makeDb({
      hasUnresolvedFlagged: true,
      config: { phone_number_id: 'pnid-1', access_token: 'enc-token' },
    });
    vi.mocked(verifyPhoneNumber).mockRejectedValue(new Error('OAuthException'));

    const result = await recheckAccountAlert(db, 'acct-1');

    expect(db.update).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('no-ops without throwing when there is no whatsapp_config row', async () => {
    const db = makeDb({ hasUnresolvedFlagged: true, config: null });

    await expect(recheckAccountAlert(db, 'acct-1')).resolves.toBe(false);
    expect(verifyPhoneNumber).not.toHaveBeenCalled();
  });

  it('no-ops without throwing when the stored token cannot be decrypted', async () => {
    vi.mocked(decrypt).mockImplementationOnce(() => {
      throw new Error('bad key');
    });
    const db = makeDb({
      hasUnresolvedFlagged: true,
      config: { phone_number_id: 'pnid-1', access_token: 'enc-token' },
    });

    await expect(recheckAccountAlert(db, 'acct-1')).resolves.toBe(false);
    expect(verifyPhoneNumber).not.toHaveBeenCalled();
  });

  it('returns false when the resolving update itself errors', async () => {
    const db = makeDb({
      hasUnresolvedFlagged: true,
      config: { phone_number_id: 'pnid-1', access_token: 'enc-token' },
      updateError: { message: 'db down' },
    });
    vi.mocked(verifyPhoneNumber).mockResolvedValue({ display_phone_number: '+1' } as never);

    await expect(recheckAccountAlert(db, 'acct-1')).resolves.toBe(false);
  });
});
