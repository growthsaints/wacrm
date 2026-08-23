import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureQualityRatingSafe, QualityRatingError } from './quality-guard';

function makeDb(qualityRating: string | null, error: { message: string } | null = null) {
  const maybeSingle = vi.fn(async () => ({ data: error ? null : { quality_rating: qualityRating }, error }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from } as unknown as SupabaseClient;
}

describe('ensureQualityRatingSafe', () => {
  it('throws QualityRatingError when quality_rating is RED', async () => {
    const db = makeDb('RED');
    await expect(ensureQualityRatingSafe(db, 'acct-1')).rejects.toBeInstanceOf(QualityRatingError);
  });

  it('does not throw when quality_rating is YELLOW', async () => {
    const db = makeDb('YELLOW');
    await expect(ensureQualityRatingSafe(db, 'acct-1')).resolves.toBeUndefined();
  });

  it('does not throw when quality_rating is GREEN', async () => {
    const db = makeDb('GREEN');
    await expect(ensureQualityRatingSafe(db, 'acct-1')).resolves.toBeUndefined();
  });

  it('does not throw when quality_rating has never been synced (null)', async () => {
    const db = makeDb(null);
    await expect(ensureQualityRatingSafe(db, 'acct-1')).resolves.toBeUndefined();
  });

  it('throws QualityRatingError when the config lookup itself fails', async () => {
    const db = makeDb(null, { message: 'db down' });
    await expect(ensureQualityRatingSafe(db, 'acct-1')).rejects.toBeInstanceOf(QualityRatingError);
  });
});
