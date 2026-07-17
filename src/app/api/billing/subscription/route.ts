import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createRazorpaySubscription } from '@/lib/billing/razorpay-client'

type SelfServePlan = 'monthly' | 'monthly_pro' | 'quarterly'

interface PostBody {
  plan?: SelfServePlan
}

// Monthly and Monthly Pro are two price tiers at the same 1-month
// cadence, so both map to plan_type 'self_serve_monthly' — which
// specific tier an account is on is derived later (see
// /api/billing/plan) by comparing its razorpay_plan_id, not by a
// separate plan_type value.
const PLAN_TERM_MONTHS: Record<SelfServePlan, number> = { monthly: 1, monthly_pro: 1, quarterly: 3 }
const PLAN_TYPE: Record<SelfServePlan, string> = {
  monthly: 'self_serve_monthly',
  monthly_pro: 'self_serve_monthly',
  quarterly: 'self_serve_quarterly',
}
const PLAN_ENV_VAR: Record<SelfServePlan, string> = {
  monthly: 'RAZORPAY_MONTHLY_PLAN_ID',
  monthly_pro: 'RAZORPAY_MONTHLY_PRO_PLAN_ID',
  quarterly: 'RAZORPAY_QUARTERLY_PLAN_ID',
}

/**
 * POST /api/billing/subscription — creates a Razorpay Subscription for
 * the self-serve plans (Monthly / Monthly Pro / Quarterly, prices read
 * live from their Razorpay Plan objects) and links it onto the
 * account. `plan_status` stays whatever it was (typically 'inactive')
 * until the webhook reports the first charge — this route only starts
 * the checkout, it doesn't confirm payment.
 *
 * This is purchase/display infrastructure only — no route or
 * middleware currently blocks access based on plan_status, so calling
 * this can't lock anyone out. That gating decision is still separate
 * and hasn't been turned on.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const body = (await request.json().catch(() => null)) as PostBody | null
    const plan = body?.plan
    if (plan !== 'monthly' && plan !== 'monthly_pro' && plan !== 'quarterly') {
      return NextResponse.json({ error: 'plan must be "monthly", "monthly_pro", or "quarterly"' }, { status: 400 })
    }

    const keyId = process.env.RAZORPAY_KEY_ID
    const keySecret = process.env.RAZORPAY_KEY_SECRET
    const planId = process.env[PLAN_ENV_VAR[plan]]
    if (!keyId || !keySecret || !planId) {
      return NextResponse.json(
        { error: `Razorpay ${plan} plan is not configured on this server.` },
        { status: 500 },
      )
    }

    const subscription = await createRazorpaySubscription({
      keyId,
      keySecret,
      planId,
      accountId,
      totalCount: 120, // effectively indefinite — renews until cancelled
    })

    const expiresAt = new Date()
    expiresAt.setMonth(expiresAt.getMonth() + PLAN_TERM_MONTHS[plan])

    const { error } = await supabase
      .from('accounts')
      .update({
        plan_type: PLAN_TYPE[plan],
        plan_status: 'inactive',
        razorpay_subscription_id: subscription.id,
        razorpay_plan_id: planId,
        plan_expires_at: expiresAt.toISOString(),
      })
      .eq('id', accountId)
    if (error) {
      console.error('[billing/subscription] account update failed:', error.message)
    }

    return NextResponse.json({ subscriptionId: subscription.id, keyId })
  } catch (err) {
    return toErrorResponse(err)
  }
}
