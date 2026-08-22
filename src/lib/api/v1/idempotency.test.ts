import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  reserveIdempotencyKey,
  fillIdempotencyKey,
  releaseIdempotencyKey,
  extractIdempotencyKey,
} from './idempotency';

/** Minimal chainable query-builder stub matching what each function calls. */
function makeDb(overrides: {
  insertError?: { code: string; message: string } | null;
  existingRow?: { response_body: unknown } | null;
}) {
  const insert = vi.fn(async () => ({ error: overrides.insertError ?? null }));
  const maybeSingle = vi.fn(async () => ({ data: overrides.existingRow ?? null }));
  const eq2 = vi.fn(() => ({ maybeSingle }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  const update = vi.fn(() => ({ eq: () => ({ eq: vi.fn(async () => ({ error: null })) }) }));
  const deleteFn = vi.fn(() => ({
    eq: () => ({ eq: () => ({ is: vi.fn(async () => ({ error: null })) }) }),
  }));

  const from = vi.fn(() => ({
    insert,
    select,
    update,
    delete: deleteFn,
  }));

  return { from, insert, select, update, delete: deleteFn } as unknown as SupabaseClient & {
    insert: typeof insert;
    select: typeof select;
    update: typeof update;
    delete: typeof deleteFn;
  };
}

describe('reserveIdempotencyKey', () => {
  it('skips reservation when no key is given', async () => {
    const db = makeDb({});
    const result = await reserveIdempotencyKey(db, 'acct-1', null);
    expect(result).toEqual({ status: 'skipped' });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('reserves a fresh key', async () => {
    const db = makeDb({ insertError: null });
    const result = await reserveIdempotencyKey(db, 'acct-1', 'order-1');
    expect(result).toEqual({ status: 'reserved' });
    expect(db.insert).toHaveBeenCalledWith({
      account_id: 'acct-1',
      idempotency_key: 'order-1',
      response_body: null,
    });
  });

  it('replays a completed response on a duplicate key', async () => {
    const db = makeDb({
      insertError: { code: '23505', message: 'duplicate key' },
      existingRow: { response_body: { message_id: 'm-1' } },
    });
    const result = await reserveIdempotencyKey(db, 'acct-1', 'order-1');
    expect(result).toEqual({
      status: 'replay',
      responseBody: { message_id: 'm-1' },
    });
  });

  it('reports in_progress for a concurrent, not-yet-filled reservation', async () => {
    const db = makeDb({
      insertError: { code: '23505', message: 'duplicate key' },
      existingRow: { response_body: null },
    });
    const result = await reserveIdempotencyKey(db, 'acct-1', 'order-1');
    expect(result).toEqual({ status: 'in_progress' });
  });

  it('treats a non-conflict insert error as skipped (best-effort)', async () => {
    const db = makeDb({ insertError: { code: '55000', message: 'db hiccup' } });
    const result = await reserveIdempotencyKey(db, 'acct-1', 'order-1');
    expect(result).toEqual({ status: 'skipped' });
  });
});

describe('fillIdempotencyKey / releaseIdempotencyKey', () => {
  it('fillIdempotencyKey updates the reserved row', async () => {
    const db = makeDb({});
    await expect(
      fillIdempotencyKey(db, 'acct-1', 'order-1', { message_id: 'm-1' }, 'm-1')
    ).resolves.toBeUndefined();
    expect(db.update).toHaveBeenCalledWith({
      response_body: { message_id: 'm-1' },
      message_id: 'm-1',
    });
  });

  it('releaseIdempotencyKey deletes the reservation', async () => {
    const db = makeDb({});
    await expect(
      releaseIdempotencyKey(db, 'acct-1', 'order-1')
    ).resolves.toBeUndefined();
    expect(db.delete).toHaveBeenCalled();
  });
});

describe('extractIdempotencyKey', () => {
  function req(headerValue?: string) {
    return new Request('https://x.test', {
      method: 'POST',
      headers: headerValue ? { 'Idempotency-Key': headerValue } : {},
    });
  }

  it('prefers the header over the body field', () => {
    expect(
      extractIdempotencyKey(req('from-header'), { idempotency_key: 'from-body' })
    ).toBe('from-header');
  });

  it('falls back to the body field when no header is set', () => {
    expect(extractIdempotencyKey(req(), { idempotency_key: 'from-body' })).toBe(
      'from-body'
    );
  });

  it('returns null when neither is set', () => {
    expect(extractIdempotencyKey(req(), {})).toBeNull();
    expect(extractIdempotencyKey(req(), null)).toBeNull();
  });

  it('trims whitespace and treats a blank value as absent', () => {
    expect(extractIdempotencyKey(req('  key  '), null)).toBe('key');
    expect(extractIdempotencyKey(req(), { idempotency_key: '   ' })).toBeNull();
  });
});
