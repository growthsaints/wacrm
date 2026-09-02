// ============================================================
// POST /api/contacts/import — starts a CSV contact import in the
// background. agent+ (matching contacts_insert's RLS floor). The
// actual insert/update/tag work runs in after() — see
// lib/contacts/import-job.ts — so this responds fast with a job id;
// the client polls GET /api/contacts/import/{id} to see progress.
// ============================================================

import { NextResponse, after } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { hasMinRole } from '@/lib/auth/roles';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { parseContactCsv } from '@/lib/contacts/parse-contact-csv';
import { runContactImportJob } from '@/lib/contacts/import-job';

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const csv = typeof body?.csv === 'string' ? body.csv : '';
    if (!csv.trim()) {
      return NextResponse.json({ error: "'csv' is required" }, { status: 400 });
    }

    const { rows } = parseContactCsv(csv);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No valid rows found — check the phone column exists and is populated' }, { status: 400 });
    }

    const { data: job, error } = await ctx.supabase
      .from('contact_import_jobs')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        status: 'processing',
        total_rows: rows.length,
      })
      .select('id')
      .single();

    if (error || !job) {
      return NextResponse.json({ error: error?.message ?? 'Failed to start the import' }, { status: 500 });
    }

    const canCreateTags = hasMinRole(ctx.role, 'admin');

    after(async () => {
      await runContactImportJob(supabaseAdmin(), {
        jobId: job.id,
        accountId: ctx.accountId,
        userId: ctx.userId,
        rows,
        canCreateTags,
      });
    });

    return NextResponse.json({ jobId: job.id, totalRows: rows.length }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
