import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { fetchRazorpayPlan } from '@/lib/billing/razorpay-client'

// Fallbacks shown only if the Razorpay Plan lookup fails (e.g. the env
// var isn't set, or Razorpay is briefly unreachable) — kept in sync
// with whatever the Plan objects were last known to charge.
const FALLBACK_MONTHLY_RUPEES = 1416
const FALLBACK_MONTHLY_PRO_RUPEES = 1770
const FALLBACK_QUARTERLY_RUPEES = 3540

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
 *  Also reports the Monthly/Monthly Pro/Quarterly self-serve prices
 *  read live from their Razorpay Plan objects, rather than hardcoding
 *  them here — the amount actually lives on the Plan (see
 *  RAZORPAY_MONTHLY_PLAN_ID / RAZORPAY_MONTHLY_PRO_PLAN_ID /
 *  RAZORPAY_QUARTERLY_PLAN_ID), so this stays correct if those Plans
 *  are ever swapped without touching this file. There are two Monthly
 *  Plan objects (not one) since Monthly and Monthly Pro are separate
 *  price tiers at the same 1-month cadence — plan_type only records
 *  the cadence ('self_serve_monthly' for both), so which tier a given
 *  account is on is derived by comparing its stored razorpay_plan_id
 *  against the Pro env var rather than needing its own plan_type
 *  value (avoids a DB migration for what's purely a pricing tier). */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data, error } = await supabase
      .from('accounts')
      .select(
        'plan_type, plan_status, plan_expires_at, managed_renewals_used, managed_renewals_max, razorpay_plan_id',
      )
      .eq('id', accountId)
      .single()
    if (error || !data) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const keyId = process.env.RAZORPAY_KEY_ID
    const keySecret = process.env.RAZORPAY_KEY_SECRET
    const [monthlyAmount, monthlyProAmount, quarterlyAmount] = await Promise.all([
      planAmountRupees(process.env.RAZORPAY_MONTHLY_PLAN_ID, keyId, keySecret, FALLBACK_MONTHLY_RUPEES),
      planAmountRupees(process.env.RAZORPAY_MONTHLY_PRO_PLAN_ID, keyId, keySecret, FALLBACK_MONTHLY_PRO_RUPEES),
      planAmountRupees(process.env.RAZORPAY_QUARTERLY_PLAN_ID, keyId, keySecret, FALLBACK_QUARTERLY_RUPEES),
    ])

    const monthlyTier =
      data.plan_type === 'self_serve_monthly'
        ? data.razorpay_plan_id && data.razorpay_plan_id === process.env.RAZORPAY_MONTHLY_PRO_PLAN_ID
          ? 'pro'
          : 'basic'
        : null

    return NextResponse.json({
      planType: data.plan_type,
      planStatus: data.plan_status,
      planExpiresAt: data.plan_expires_at,
      managedRenewalsUsed: data.managed_renewals_used,
      managedRenewalsMax: data.managed_renewals_max,
      monthlyAmount,
      monthlyProAmount,
      quarterlyAmount,
      monthlyTier,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
