// ============================================================
// DELETE /api/meta-ads/campaigns/{id} — remove wacrm's record of this
//        campaign. Does not delete the Campaign/Ad Set/Ad objects on
//        Meta's side (if any were created before a later step failed)
//        — an admin can clean those up from Ads Manager directly;
//        they stay PAUSED so there's no spend risk either way.
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params

    const { data, error } = await ctx.supabase
      .from('meta_ad_campaigns')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

    return NextResponse.json({ id: data.id, deleted: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
