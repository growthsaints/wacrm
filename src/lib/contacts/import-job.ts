// ============================================================
// Runs a CSV contact import server-side, in the background — the
// same "ack fast, do the real work after()" pattern as the WhatsApp
// webhook, broadcast delivery, and Meta Ads campaign launch. Moved
// out of the browser (see components/contacts/import-modal.tsx's
// history) so a 40k+ row import survives the tab being closed and
// isn't bottlenecked by one network round trip per insert chunk.
//
// Never throws — every failure path marks the job row 'failed' with
// a human-readable reason, since there's no caller left to receive
// an exception once this runs in the background.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  dedupeByPhone,
  fetchExistingPhonesByAccount,
  isUniqueViolation,
  normalizeKey,
} from '@/lib/contacts/dedupe';
import type { ParsedContactRow } from '@/lib/contacts/parse-contact-csv';
import {
  assignImportedContactTags,
  resolveImportTagIds,
  type ContactTagAssignment,
} from '@/lib/contacts/resolve-import-tags';

const INSERT_CHUNK_SIZE = 500;

async function markFailed(db: SupabaseClient, jobId: string, message: string): Promise<void> {
  const { error } = await db
    .from('contact_import_jobs')
    .update({ status: 'failed', error_message: message, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) {
    console.error('[contacts/import-job] failed to mark job failed:', error.message);
  }
}

export interface RunContactImportJobArgs {
  jobId: string;
  accountId: string;
  userId: string;
  rows: ParsedContactRow[];
  /** admin+ only — mirrors the dashboard's canEditSettings gate for auto-creating missing tags. */
  canCreateTags: boolean;
}

export async function runContactImportJob(db: SupabaseClient, args: RunContactImportJobArgs): Promise<void> {
  const { jobId, accountId, userId, rows, canCreateTags } = args;

  try {
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    // 1) De-dupe within the file by normalized phone (keep first).
    const { unique, duplicates: inFileDupes } = dedupeByPhone(rows);
    skipped += inFileDupes;

    // 2) Split into genuinely-new rows vs. rows matching a contact
    //    already in this account.
    const existingIdByPhone = await fetchExistingPhonesByAccount(db, accountId);

    const toInsert: ParsedContactRow[] = [];
    const toUpdate: { id: string; row: ParsedContactRow }[] = [];
    for (const row of unique) {
      const existingId = existingIdByPhone.get(normalizeKey(row.phone));
      if (existingId) {
        toUpdate.push({ id: existingId, row });
      } else {
        toInsert.push(row);
      }
    }

    // 3) Resolve tag names → ids.
    const allTagNames = [...toInsert, ...toUpdate.map((u) => u.row)].flatMap((row) => row.tagNames);
    let tagIdByKey = new Map<string, string>();
    if (allTagNames.length > 0) {
      ({ tagIdByKey } = await resolveImportTagIds(db, {
        accountId,
        userId,
        tagNames: allTagNames,
        canCreateTags,
      }));
    }

    const tagAssignments: ContactTagAssignment[] = [];

    // 3b) Update rows that matched an existing contact by phone. Only
    //     overwrite a field when the CSV actually supplied a value.
    for (const { id, row } of toUpdate) {
      const patch: Record<string, string> = {};
      if (row.name?.trim()) patch.name = row.name.trim();
      if (row.email?.trim()) patch.email = row.email.trim();
      if (row.company?.trim()) patch.company = row.company.trim();

      if (Object.keys(patch).length > 0) {
        const { error } = await db.from('contacts').update(patch).eq('id', id);
        if (error) {
          failed++;
          continue;
        }
      }
      updated++;
      if (row.tagNames.length > 0) {
        tagAssignments.push({ contactId: id, tagNames: row.tagNames });
      }

      await touchProgress(db, jobId, updated + imported + skipped + failed);
    }

    // 4) Batch insert the genuinely-new rows. A failed chunk retries
    //    row-by-row so one bad/duplicate row doesn't sink the chunk.
    for (let i = 0; i < toInsert.length; i += INSERT_CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + INSERT_CHUNK_SIZE);
      const insertRows = chunk.map((row) => ({
        user_id: userId,
        account_id: accountId,
        phone: row.phone,
        name: row.name || null,
        email: row.email || null,
        company: row.company || null,
        source: 'import' as const,
      }));

      const { data, error } = await db.from('contacts').insert(insertRows).select('id');

      if (error) {
        for (let j = 0; j < insertRows.length; j++) {
          const insertRow = insertRows[j];
          const source = chunk[j];
          const { data: singleData, error: singleErr } = await db
            .from('contacts')
            .insert(insertRow)
            .select('id')
            .single();

          if (!singleErr && singleData) {
            imported++;
            if (source.tagNames.length > 0) {
              tagAssignments.push({ contactId: singleData.id, tagNames: source.tagNames });
            }
          } else if (isUniqueViolation(singleErr)) {
            skipped++;
          } else {
            failed++;
          }
        }
      } else {
        const inserted = data ?? [];
        imported += inserted.length;
        for (let j = 0; j < inserted.length; j++) {
          const source = chunk[j];
          if (!source || source.tagNames.length === 0) continue;
          tagAssignments.push({ contactId: inserted[j].id, tagNames: source.tagNames });
        }
      }

      await touchProgress(db, jobId, updated + imported + skipped + failed);
    }

    // 5) Wire tags onto the contacts just created/updated. Failure here
    //    must not mask an otherwise-successful import.
    let tagsAssigned = 0;
    try {
      tagsAssigned = await assignImportedContactTags(db, tagAssignments, tagIdByKey);
    } catch (err) {
      console.error('[contacts/import-job] tag assignment failed:', err instanceof Error ? err.message : err);
    }

    const { error: doneError } = await db
      .from('contact_import_jobs')
      .update({
        status: 'completed',
        processed_rows: rows.length,
        imported_count: imported,
        updated_count: updated,
        skipped_count: skipped,
        failed_count: failed,
        tags_assigned_count: tagsAssigned,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);
    if (doneError) {
      console.error('[contacts/import-job] failed to mark job completed:', doneError.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error running the contact import';
    console.error('[contacts/import-job] import failed:', message);
    await markFailed(db, jobId, message);
  }
}

/** Best-effort progress update — never lets a progress-write failure interrupt the import itself. */
async function touchProgress(db: SupabaseClient, jobId: string, processedRows: number): Promise<void> {
  try {
    await db
      .from('contact_import_jobs')
      .update({ processed_rows: processedRows, updated_at: new Date().toISOString() })
      .eq('id', jobId);
  } catch (err) {
    console.error('[contacts/import-job] progress update failed:', err instanceof Error ? err.message : err);
  }
}
