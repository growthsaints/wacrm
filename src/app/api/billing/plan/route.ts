import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/** GET /api/billing/plan — current plan status for Settings → Billing. */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data, error } = await supabase
      .from('accounts')
      .select(
        'plan_type, plan_status, plan_expires_at, managed_renewals_used, managed_renewals_max',
      )
      .eq('id', accountId)
      .single()
    if (error || !data) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    return NextResponse.json({
      planType: data.plan_type,
      planStatus: data.plan_status,
      planExpiresAt: data.plan_expires_at,
      managedRenewalsUsed: data.managed_renewals_used,
      managedRenewalsMax: data.managed_renewals_max,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
