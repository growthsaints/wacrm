import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { fetchRazorpayPayment, verifyRazorpayPaymentSignature } from '@/lib/billing/razorpay-client'
import { supabaseAdmin } from '@/lib/billing/admin-client'
import { recordInvoice } from '@/lib/billing/invoices'

interface PostBody {
  razorpay_order_id?: string
  razorpay_payment_id?: string
  razorpay_signature?: string
}

/** POST /api/billing/recharge/verify — called by the client immediately
 *  after Razorpay Checkout's success callback. Verifies the payment
 *  signature, then re-fetches the payment from Razorpay directly to
 *  get the authoritative captured amount and the base/GST split
 *  stashed in its notes at order-creation time (never trusts a
 *  client-supplied amount — a tampered client could otherwise credit
 *  itself more than it paid). The webhook (/api/webhooks/razorpay)
 *  independently does the same credit as a fallback if this call is
 *  missed (tab closed, network drop) — the unique index on
 *  razorpay_payment_id makes crediting twice a no-op. */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('owner')

    const body = (await request.json().catch(() => null)) as PostBody | null
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body ?? {}
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json({ error: 'Missing payment verification fields' }, { status: 400 })
    }

    const keyId = process.env.RAZORPAY_KEY_ID
    const keySecret = process.env.RAZORPAY_KEY_SECRET
    if (!keyId || !keySecret) {
      return NextResponse.json({ error: 'Razorpay is not configured on this server.' }, { status: 500 })
    }

    const valid = await verifyRazorpayPaymentSignature({
      keySecret,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    })
    if (!valid) {
      return NextResponse.json({ error: 'Payment signature verification failed' }, { status: 400 })
    }

    const payment = await fetchRazorpayPayment({ keyId, keySecret, paymentId: razorpay_payment_id })
    if (payment.orderId !== razorpay_order_id) {
      return NextResponse.json({ error: 'Payment does not match order' }, { status: 400 })
    }
    if (payment.status !== 'captured') {
      return NextResponse.json({ error: 'Payment has not been captured' }, { status: 400 })
    }
    if (payment.notes.account_id !== accountId) {
      return NextResponse.json({ error: 'Payment does not belong to this account' }, { status: 403 })
    }

    const baseAmount = Number(payment.notes.base_amount)
    const gstAmt = Number(payment.notes.gst_amount ?? 0)
    if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
      return NextResponse.json({ error: 'Payment is missing its amount breakdown' }, { status: 500 })
    }

    const admin = supabaseAdmin()
    const { data, error } = await admin.rpc('credit_wallet', {
      p_account_id: accountId,
      p_amount: baseAmount,
      p_razorpay_payment_id: razorpay_payment_id,
      p_razorpay_order_id: razorpay_order_id,
      p_gst_amount: gstAmt,
      p_total_paid: payment.amount / 100,
    })

    if (error) {
      // Unique-violation on razorpay_payment_id means the webhook (or a
      // duplicate client call) already credited this exact payment —
      // not an error from the caller's point of view.
      if (error.code === '23505') {
        return NextResponse.json({ credited: true, alreadyProcessed: true })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await recordInvoice(admin, {
      accountId,
      invoiceType: 'wallet_recharge',
      description: 'WhatsApp Conversation Credits recharge',
      baseAmount,
      gstAmount: gstAmt,
      totalAmount: payment.amount / 100,
      razorpayPaymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_order_id,
    })

    return NextResponse.json({ credited: true, newBalance: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
