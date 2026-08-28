// ============================================================
// DELETE /api/meta-ads/audiences/{id} — remove wacrm's record of this
//        audience. Does not delete the Custom Audience object on
//        Meta's side — an admin can do that from Ads Manager directly
//        if they also want it gone there.
//
// See ./resync/route.ts for re-running the sync against Meta.
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params

    const { data, error } = await ctx.supabase
      .from('meta_custom_audiences')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Audience not found' }, { status: 404 })

    return NextResponse.json({ id: data.id, deleted: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
