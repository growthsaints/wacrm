import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { runContactImportJob } from './import-job';
import type { ParsedContactRow } from './parse-contact-csv';

/** Builds a minimal mock DB covering every table runContactImportJob
 *  touches: contacts (existing-phone lookup / insert / update),
 *  contact_import_jobs (progress + final status), and tags (only
 *  reached when a row carries tagNames — most tests here don't).
 *  `existingContacts` seeds fetchExistingPhonesByAccount's result;
 *  `insertShouldFail` simulates a batch-insert error to exercise the
 *  per-row retry fallback. */
function makeDb(args: {
  existingContacts?: Array<{ id: string; phone_normalized: string }>;
  insertShouldFail?: boolean;
} = {}) {
  const existingContacts = args.existingContacts ?? [];
  const jobUpdates: Record<string, unknown>[] = [];
  const contactUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  let nextInsertId = 0;

  const from = vi.fn((table: string) => {
    if (table === 'contact_import_jobs') {
      return {
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            jobUpdates.push(patch);
            return { error: null };
          },
        }),
      };
    }
    if (table === 'contacts') {
      return {
        select: (cols: string) => {
          if (cols.includes('phone_normalized')) {
            return {
              eq: () => ({
                range: vi.fn(() => Promise.resolve({ data: existingContacts, error: null })),
              }),
            };
          }
          throw new Error(`unexpected contacts select: ${cols}`);
        },
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            contactUpdates.push({ id, patch });
            return { error: null };
          },
        }),
        insert: (rows: unknown) => {
          const rowArray = Array.isArray(rows) ? rows : [rows];
          // insertShouldFail only fails the batch call (array of >1) —
          // the per-row fallback (a single object, not an array) must
          // still succeed, or there's nothing to fall back to.
          const shouldFail = args.insertShouldFail && Array.isArray(rows);
          return {
            select: (_cols: string) => {
              if (shouldFail) {
                return { data: null, error: { message: 'insert failed' } };
              }
              const data = rowArray.map(() => ({ id: `new-${nextInsertId++}` }));
              return {
                data,
                error: null,
                // Only reached via .select('id').single() in the per-row fallback.
                single: async () => ({ data: data[0], error: null }),
              };
            },
          };
        },
      };
    }
    if (table === 'tags') {
      return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { db: { from } as unknown as SupabaseClient, jobUpdates, contactUpdates };
}

function row(phone: string, overrides: Partial<ParsedContactRow> = {}): ParsedContactRow {
  return { phone, tagNames: [], ...overrides };
}

describe('runContactImportJob', () => {
  it('inserts new rows and marks the job completed with the right counts', async () => {
    const { db, jobUpdates } = makeDb();
    await runContactImportJob(db, {
      jobId: 'job-1',
      accountId: 'acct-1',
      userId: 'user-1',
      rows: [row('+911111111111'), row('+912222222222')],
      canCreateTags: false,
    });

    const finalUpdate = jobUpdates[jobUpdates.length - 1];
    expect(finalUpdate).toMatchObject({ status: 'completed', imported_count: 2, updated_count: 0, skipped_count: 0, failed_count: 0 });
  });

  it('updates an existing contact by phone instead of inserting a duplicate', async () => {
    const { db, jobUpdates, contactUpdates } = makeDb({
      existingContacts: [{ id: 'existing-1', phone_normalized: '911111111111' }],
    });
    await runContactImportJob(db, {
      jobId: 'job-1',
      accountId: 'acct-1',
      userId: 'user-1',
      rows: [row('+91 1111 111 111', { name: 'Updated Name' })],
      canCreateTags: false,
    });

    expect(contactUpdates).toEqual([{ id: 'existing-1', patch: { name: 'Updated Name' } }]);
    const finalUpdate = jobUpdates[jobUpdates.length - 1];
    expect(finalUpdate).toMatchObject({ status: 'completed', imported_count: 0, updated_count: 1 });
  });

  it('counts in-file duplicate phone numbers as skipped, not imported twice', async () => {
    const { db, jobUpdates } = makeDb();
    await runContactImportJob(db, {
      jobId: 'job-1',
      accountId: 'acct-1',
      userId: 'user-1',
      rows: [row('+911111111111'), row('911111111111')], // same digits
      canCreateTags: false,
    });

    const finalUpdate = jobUpdates[jobUpdates.length - 1];
    expect(finalUpdate).toMatchObject({ status: 'completed', imported_count: 1, skipped_count: 1 });
  });

  it('falls back to per-row inserts when the batch insert fails', async () => {
    const { db, jobUpdates } = makeDb({ insertShouldFail: true });
    await runContactImportJob(db, {
      jobId: 'job-1',
      accountId: 'acct-1',
      userId: 'user-1',
      rows: [row('+911111111111')],
      canCreateTags: false,
    });

    const finalUpdate = jobUpdates[jobUpdates.length - 1];
    expect(finalUpdate).toMatchObject({ status: 'completed', imported_count: 1 });
  });

  it('marks the job failed, not thrown, when the existing-contacts lookup errors', async () => {
    const jobUpdates: Record<string, unknown>[] = [];
    const db = {
      from: vi.fn((table: string) => {
        if (table === 'contact_import_jobs') {
          return {
            update: (patch: Record<string, unknown>) => ({
              eq: async () => {
                jobUpdates.push(patch);
                return { error: null };
              },
            }),
          };
        }
        if (table === 'contacts') {
          return {
            select: () => ({
              eq: () => ({
                range: () => Promise.resolve({ data: null, error: { message: 'db exploded' } }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient;

    await expect(
      runContactImportJob(db, {
        jobId: 'job-1',
        accountId: 'acct-1',
        userId: 'user-1',
        rows: [row('+911111111111')],
        canCreateTags: false,
      }),
    ).resolves.toBeUndefined();

    expect(jobUpdates).toEqual([
      expect.objectContaining({ status: 'failed', error_message: 'db exploded' }),
    ]);
  });
});
