import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createRazorpaySubscription } from '@/lib/billing/razorpay-client'

interface PostBody {
  plan?: 'monthly' | 'quarterly'
}

/**
 * POST /api/billing/subscription — creates a Razorpay Subscription for
 * the self-serve plans (monthly ₹1200 / quarterly ₹3000). Nothing
 * currently calls this from the signup flow — it's infrastructure
 * only, wired up separately once the actual signup-gating decision is
 * confirmed (this changes what happens to every new/existing account,
 * so it isn't turned on here).
 */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')

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

    const subscription = await createRazorpaySubscription({ keyId, keySecret, planId, accountId })

    return NextResponse.json({ subscriptionId: subscription.id, keyId })
  } catch (err) {
    return toErrorResponse(err)
  }
}
