import { NextResponse } from 'next/server'
import { verifyRazorpayWebhookSignature } from '@/lib/billing/razorpay-client'
import { supabaseAdmin } from '@/lib/billing/admin-client'
import { recordInvoice } from '@/lib/billing/invoices'
import { GST_RATE } from '@/lib/billing/rates'

// Monthly and Monthly Pro share plan_type 'self_serve_monthly' (see
// /api/billing/subscription) — only razorpay_plan_id tells them apart.
function subscriptionTierLabel(planType: string, razorpayPlanId: string | null): string {
  if (planType === 'managed') return 'Managed plan'
  if (planType === 'self_serve_quarterly') return 'Self-serve Quarterly plan'
  if (planType === 'self_serve_monthly') {
    return razorpayPlanId === process.env.RAZORPAY_MONTHLY_PRO_PLAN_ID
      ? 'Self-serve Monthly Pro plan'
      : 'Self-serve Monthly plan'
  }
  return 'Subscription plan'
}

/**
 * POST /api/webhooks/razorpay
 *
 * Authoritative server-to-server confirmation of a wallet recharge —
 * independent of /api/billing/recharge/verify (the client-side path,
 * which can be missed if the tab closes before the callback fires).
 * The unique index on wallet_transactions.razorpay_payment_id makes
 * crediting the same payment from both paths a safe no-op.
 *
 * Configure this URL in Razorpay Dashboard → Settings → Webhooks,
 * subscribed to the `payment.captured` event, with the same secret as
 * RAZORPAY_WEBHOOK_SECRET.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-razorpay-signature')
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const valid = await verifyRazorpayWebhookSignature(rawBody, signature, webhookSecret)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const payload = JSON.parse(rawBody || '{}') as {
    event?: string
    payload?: {
      payment?: { entity?: Record<string, unknown> }
      subscription?: { entity?: Record<string, unknown> }
    }
  }

  const admin = supabaseAdmin()

  if (payload.event === 'payment.captured') {
    const payment = payload.payload?.payment?.entity
    if (!payment) {
      return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
    }
    const notes = (payment.notes as Record<string, string> | undefined) ?? {}
    if (notes.purpose === 'wallet_recharge' && notes.account_id) {
      // base_amount/gst_amount were stashed in the order's notes at
      // creation time (see /api/billing/recharge) and Razorpay copies
      // order notes onto the resulting payment entity, so this is the
      // same authoritative split the verify route reads — only the
      // base amount is ever credited to wallet_balance.
      const totalPaid = (payment.amount as number) / 100
      const baseAmount = Number(notes.base_amount ?? totalPaid)
      const gstAmt = Number(notes.gst_amount ?? 0)
      const { error } = await admin.rpc('credit_wallet', {
        p_account_id: notes.account_id,
        p_amount: baseAmount,
        p_razorpay_payment_id: payment.id as string,
        p_razorpay_order_id: payment.order_id as string,
        p_gst_amount: gstAmt,
        p_total_paid: totalPaid,
      })
      if (error && error.code !== '23505') {
        console.error('[razorpay-webhook] credit_wallet failed:', error.message)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      await recordInvoice(admin, {
        accountId: notes.account_id,
        invoiceType: 'wallet_recharge',
        description: 'WhatsApp Conversation Credits recharge',
        baseAmount,
        gstAmount: gstAmt,
        totalAmount: totalPaid,
        razorpayPaymentId: payment.id as string,
        razorpayOrderId: payment.order_id as string,
      })
    }
    return NextResponse.json({ received: true })
  }

  // Self-serve/Managed subscription lifecycle — see
  // createRazorpaySubscription (notes.account_id is stashed there the
  // same way order notes are).
  if (
    payload.event === 'subscription.activated' ||
    payload.event === 'subscription.charged' ||
    payload.event === 'subscription.cancelled' ||
    payload.event === 'subscription.completed' ||
    payload.event === 'subscription.halted'
  ) {
    const subscription = payload.payload?.subscription?.entity
    if (!subscription) {
      return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
    }
    const notes = (subscription.notes as Record<string, string> | undefined) ?? {}
    const accountId = notes.account_id
    if (!accountId) {
      return NextResponse.json({ received: true })
    }

    // `completed` fires once a subscription exhausts its total_count —
    // for the Managed plan's single-cycle (total_count: 1) subscription
    // that happens right after its one successful charge, meaning "term
    // fulfilled", not "cancelled". Only an explicit cancel/halt from
    // Razorpay should flip status to cancelled.
    const isCancelled =
      payload.event === 'subscription.cancelled' || payload.event === 'subscription.halted'
    const nextStatus = isCancelled ? 'cancelled' : 'active'

    const update: Record<string, unknown> = {
      plan_status: nextStatus,
      razorpay_subscription_id: subscription.id as string,
      razorpay_plan_id: subscription.plan_id as string,
    }

    // Recurring self-serve plans: push the expiry out another billing
    // cycle on each successful renewal charge. The Managed plan's
    // one-off 3-month term keeps the fixed expiry set at creation.
    if (payload.event === 'subscription.charged') {
      const { data: account } = await admin
        .from('accounts')
        .select('plan_type, plan_expires_at, razorpay_plan_id')
        .eq('id', accountId)
        .single()
      if (account?.plan_type === 'self_serve_monthly' || account?.plan_type === 'self_serve_quarterly') {
        const months = account.plan_type === 'self_serve_monthly' ? 1 : 3
        const base = account.plan_expires_at ? new Date(account.plan_expires_at) : new Date()
        const next = base > new Date() ? base : new Date()
        next.setMonth(next.getMonth() + months)
        update.plan_expires_at = next.toISOString()
      }

      // The Plan's amount is a single GST-inclusive figure (there's no
      // separate base/GST split stored anywhere for subscriptions, unlike
      // wallet recharge order notes) — back it out assuming the standard
      // 18% rate, which holds for every Plan created after the GST
      // rollout.
      const chargePayment = payload.payload?.payment?.entity
      if (account && chargePayment) {
        const totalPaid = (chargePayment.amount as number) / 100
        const baseAmount = Math.round((totalPaid / (1 + GST_RATE)) * 100) / 100
        const gstAmt = Math.round((totalPaid - baseAmount) * 100) / 100
        await recordInvoice(admin, {
          accountId,
          invoiceType: 'subscription',
          description: subscriptionTierLabel(account.plan_type, account.razorpay_plan_id),
          baseAmount,
          gstAmount: gstAmt,
          totalAmount: totalPaid,
          razorpayPaymentId: chargePayment.id as string,
          razorpayOrderId: (chargePayment.order_id as string) ?? null,
        })
      }
    }

    const { error } = await admin.from('accounts').update(update).eq('id', accountId)
    if (error) {
      console.error('[razorpay-webhook] subscription status update failed:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ received: true })
  }

  // Not an event we act on — acknowledge so Razorpay stops retrying.
  return NextResponse.json({ received: true })
}
