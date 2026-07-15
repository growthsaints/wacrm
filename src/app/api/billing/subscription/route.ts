import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createRazorpaySubscription } from '@/lib/billing/razorpay-client'

interface PostBody {
  plan?: 'monthly' | 'quarterly'
}

const PLAN_TERM_MONTHS = { monthly: 1, quarterly: 3 } as const

/**
 * POST /api/billing/subscription — creates a Razorpay Subscription for
 * the self-serve plans (monthly ₹1200 / quarterly ₹3000) and links it
 * onto the account. `plan_status` stays whatever it was (typically
 * 'inactive') until the webhook reports the first charge — this route
 * only starts the checkout, it doesn't confirm payment.
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
    if (plan !== 'monthly' && plan !== 'quarterly') {
      return NextResponse.json({ error: 'plan must be "monthly" or "quarterly"' }, { status: 400 })
    }

    const keyId = process.env.RAZORPAY_KEY_ID
    const keySecret = process.env.RAZORPAY_KEY_SECRET
    const planId = plan === 'monthly' ? process.env.RAZORPAY_MONTHLY_PLAN_ID : process.env.RAZORPAY_QUARTERLY_PLAN_ID
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
        plan_type: plan === 'monthly' ? 'self_serve_monthly' : 'self_serve_quarterly',
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
