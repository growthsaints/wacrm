// ============================================================
// POST /api/meta-ads/audiences/{id}/resync — re-run a saved CRM
// segment against Meta, picking up contacts added/removed since the
// last sync (Meta's Custom Audience membership is additive-only per
// upload — this doesn't remove anyone, it only adds anyone new that
// now matches the segment). admin+.
// ============================================================

import { NextResponse, after } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { syncCustomAudience } from '@/lib/meta-ads/sync'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params

    const { data, error } = await ctx.supabase
      .from('meta_custom_audiences')
      .update({ status: 'creating', error_message: null })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Audience not found' }, { status: 404 })

    after(async () => {
      await syncCustomAudience(supabaseAdmin(), data.id)
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
