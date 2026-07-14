import { NextResponse } from 'next/server'
import { verifyRazorpayWebhookSignature } from '@/lib/billing/razorpay-client'
import { supabaseAdmin } from '@/lib/billing/admin-client'

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
    payload?: { payment?: { entity?: Record<string, unknown> } }
  }

  if (payload.event !== 'payment.captured') {
    // Not an event we act on — acknowledge so Razorpay stops retrying.
    return NextResponse.json({ received: true })
  }

  const payment = payload.payload?.payment?.entity
  if (!payment) {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
  }

  const notes = (payment.notes as Record<string, string> | undefined) ?? {}
  const accountId = notes.account_id
  const paymentId = payment.id as string
  const orderId = payment.order_id as string
  const amountPaise = payment.amount as number

  if (!accountId || notes.purpose !== 'wallet_recharge') {
    // Not one of our wallet-recharge orders — ignore.
    return NextResponse.json({ received: true })
  }

  const admin = supabaseAdmin()
  const { error } = await admin.rpc('credit_wallet', {
    p_account_id: accountId,
    p_amount: amountPaise / 100,
    p_razorpay_payment_id: paymentId,
    p_razorpay_order_id: orderId,
  })

  if (error && error.code !== '23505') {
    console.error('[razorpay-webhook] credit_wallet failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
