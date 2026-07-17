import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { fetchRazorpayPlan } from '@/lib/billing/razorpay-client'

// Fallbacks shown only if the Razorpay Plan lookup fails (e.g. the env
// var isn't set, or Razorpay is briefly unreachable) — kept in sync
// with whatever the Plan objects were last known to charge.
const FALLBACK_MONTHLY_RUPEES = 1200
const FALLBACK_QUARTERLY_RUPEES = 3000

async function planAmountRupees(planId: string | undefined, keyId: string | undefined, keySecret: string | undefined, fallback: number): Promise<number> {
  if (!planId || !keyId || !keySecret) return fallback
  try {
    const plan = await fetchRazorpayPlan({ keyId, keySecret, planId })
    return plan.amount / 100
  } catch (err) {
    console.error('[billing/plan] Razorpay plan lookup failed:', err)
    return fallback
  }
}

/** GET /api/billing/plan — current plan status for Settings → Billing.
 *  Also reports the Monthly/Quarterly self-serve prices read live from
 *  their Razorpay Plan objects, rather than hardcoding them here — the
 *  amount actually lives on the Plan (see RAZORPAY_MONTHLY_PLAN_ID /
 *  RAZORPAY_QUARTERLY_PLAN_ID), so this stays correct if those Plans
 *  are ever swapped for GST-inclusive ones without touching this
 *  file. */
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

    const keyId = process.env.RAZORPAY_KEY_ID
    const keySecret = process.env.RAZORPAY_KEY_SECRET
    const [monthlyAmount, quarterlyAmount] = await Promise.all([
      planAmountRupees(process.env.RAZORPAY_MONTHLY_PLAN_ID, keyId, keySecret, FALLBACK_MONTHLY_RUPEES),
      planAmountRupees(process.env.RAZORPAY_QUARTERLY_PLAN_ID, keyId, keySecret, FALLBACK_QUARTERLY_RUPEES),
    ])

    return NextResponse.json({
      planType: data.plan_type,
      planStatus: data.plan_status,
      planExpiresAt: data.plan_expires_at,
      managedRenewalsUsed: data.managed_renewals_used,
      managedRenewalsMax: data.managed_renewals_max,
      monthlyAmount,
      quarterlyAmount,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
