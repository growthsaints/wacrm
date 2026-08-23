import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((v: string) => `decrypted:${v}`),
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  verifyPhoneNumber: vi.fn(),
}));

import { handleQualityRatingChange, hasQualityRatingWorsened } from './quality-alert';
import { decrypt } from '@/lib/whatsapp/encryption';
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api';

describe('hasQualityRatingWorsened', () => {
  it('is true when moving to a strictly worse rating', () => {
    expect(hasQualityRatingWorsened('GREEN', 'YELLOW')).toBe(true);
    expect(hasQualityRatingWorsened('GREEN', 'RED')).toBe(true);
    expect(hasQualityRatingWorsened('YELLOW', 'RED')).toBe(true);
  });

  it('is false when unchanged or improving', () => {
    expect(hasQualityRatingWorsened('YELLOW', 'YELLOW')).toBe(false);
    expect(hasQualityRatingWorsened('RED', 'YELLOW')).toBe(false);
    expect(hasQualityRatingWorsened('RED', 'GREEN')).toBe(false);
  });

  it('treats a null baseline as worsened only if the new rating is not Green', () => {
    expect(hasQualityRatingWorsened(null, 'GREEN')).toBe(false);
    expect(hasQualityRatingWorsened(null, 'YELLOW')).toBe(true);
    expect(hasQualityRatingWorsened(null, 'RED')).toBe(true);
  });

  it('is false when next is missing/unrecognized', () => {
    expect(hasQualityRatingWorsened('GREEN', null)).toBe(false);
    expect(hasQualityRatingWorsened('GREEN', 'UNKNOWN')).toBe(false);
  });
});

function makeDb(opts: {
  config?: { phone_number_id?: string | null; access_token?: string | null; quality_rating?: string | null } | null;
  configError?: { message: string } | null;
  ownerUserId?: string | null;
}) {
  const configMaybeSingle = vi.fn(async () => ({
    data: opts.config ?? null,
    error: opts.configError ?? null,
  }));
  const configEq = vi.fn(() => ({ maybeSingle: configMaybeSingle }));
  const configSelect = vi.fn(() => ({ eq: configEq }));

  const updateEq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));

  const accountMaybeSingle = vi.fn(async () => ({
    data: opts.ownerUserId === undefined ? { owner_user_id: 'owner-1' } : { owner_user_id: opts.ownerUserId },
    error: null,
  }));
  const accountEq = vi.fn(() => ({ maybeSingle: accountMaybeSingle }));
  const accountSelect = vi.fn(() => ({ eq: accountEq }));

  const insert = vi.fn(async () => ({ error: null }));

  const from = vi.fn((table: string) => {
    if (table === 'whatsapp_config') return { select: configSelect, update };
    if (table === 'accounts') return { select: accountSelect };
    if (table === 'notifications') return { insert };
    throw new Error(`unexpected table: ${table}`);
  });

  return { from, update, updateEq, insert } as unknown as SupabaseClient & {
    update: typeof update;
    updateEq: typeof updateEq;
    insert: typeof insert;
  };
}

describe('handleQualityRatingChange', () => {
  beforeEach(() => {
    vi.mocked(verifyPhoneNumber).mockReset();
    vi.mocked(decrypt).mockClear();
  });

  it('refreshes whatsapp_config from Meta and notifies the owner when the rating worsens', async () => {
    const db = makeDb({
      config: { phone_number_id: 'pnid-1', access_token: 'enc-token', quality_rating: 'GREEN' },
    });
    vi.mocked(verifyPhoneNumber).mockResolvedValue({
      display_phone_number: '+1',
      quality_rating: 'RED',
      whatsapp_business_manager_messaging_limit: 'TIER_1K',
    } as never);

    await handleQualityRatingChange(db, 'acct-1');

    expect(verifyPhoneNumber).toHaveBeenCalledWith({
      phoneNumberId: 'pnid-1',
      accessToken: 'decrypted:enc-token',
    });
    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({ quality_rating: 'RED', messaging_limit_tier: 'TIER_1K' })
    );
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'acct-1',
        user_id: 'owner-1',
        type: 'quality_rating_changed',
      })
    );
  });

  it('does not notify when the rating is unchanged', async () => {
    const db = makeDb({
      config: { phone_number_id: 'pnid-1', access_token: 'enc-token', quality_rating: 'YELLOW' },
    });
    vi.mocked(verifyPhoneNumber).mockResolvedValue({
      quality_rating: 'YELLOW',
    } as never);

    await handleQualityRatingChange(db, 'acct-1');

    expect(db.update).toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('does not notify when the rating improves', async () => {
    const db = makeDb({
      config: { phone_number_id: 'pnid-1', access_token: 'enc-token', quality_rating: 'RED' },
    });
    vi.mocked(verifyPhoneNumber).mockResolvedValue({
      quality_rating: 'YELLOW',
    } as never);

    await handleQualityRatingChange(db, 'acct-1');

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('no-ops without throwing when there is no config row', async () => {
    const db = makeDb({ config: null });
    await expect(handleQualityRatingChange(db, 'acct-1')).resolves.toBeUndefined();
    expect(verifyPhoneNumber).not.toHaveBeenCalled();
  });

  it('no-ops without throwing when the stored token cannot be decrypted', async () => {
    vi.mocked(decrypt).mockImplementationOnce(() => {
      throw new Error('bad key');
    });
    const db = makeDb({
      config: { phone_number_id: 'pnid-1', access_token: 'enc-token', quality_rating: 'GREEN' },
    });

    await expect(handleQualityRatingChange(db, 'acct-1')).resolves.toBeUndefined();
    expect(verifyPhoneNumber).not.toHaveBeenCalled();
  });

  it('no-ops without throwing when verifyPhoneNumber itself throws', async () => {
    const db = makeDb({
      config: { phone_number_id: 'pnid-1', access_token: 'enc-token', quality_rating: 'GREEN' },
    });
    vi.mocked(verifyPhoneNumber).mockRejectedValue(new Error('meta down'));

    await expect(handleQualityRatingChange(db, 'acct-1')).resolves.toBeUndefined();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('skips notifying when the account has no resolvable owner', async () => {
    const db = makeDb({
      config: { phone_number_id: 'pnid-1', access_token: 'enc-token', quality_rating: 'GREEN' },
      ownerUserId: null,
    });
    vi.mocked(verifyPhoneNumber).mockResolvedValue({ quality_rating: 'RED' } as never);

    await handleQualityRatingChange(db, 'acct-1');

    expect(db.insert).not.toHaveBeenCalled();
  });
});
