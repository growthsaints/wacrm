// ============================================================
// GET /api/contacts/import/{id} — poll a background CSV import job's
// progress/result. See lib/contacts/import-job.ts.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const { data: job, error } = await ctx.supabase
      .from('contact_import_jobs')
      .select(
        'id, status, total_rows, processed_rows, imported_count, updated_count, skipped_count, failed_count, tags_assigned_count, error_message',
      )
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error || !job) {
      return NextResponse.json({ error: 'Import job not found' }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (err) {
    return toErrorResponse(err);
  }
}
