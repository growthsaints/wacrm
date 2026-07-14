import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { verifyRazorpayPaymentSignature } from '@/lib/billing/razorpay-client'
import { supabaseAdmin } from '@/lib/billing/admin-client'

interface PostBody {
  razorpay_order_id?: string
  razorpay_payment_id?: string
  razorpay_signature?: string
  amount?: number
}

/** POST /api/billing/recharge/verify — called by the client immediately
 *  after Razorpay Checkout's success callback. Verifies the payment
 *  signature and credits the wallet. The webhook
 *  (/api/webhooks/razorpay) independently does the same credit as a
 *  fallback if this call is missed (tab closed, network drop) — the
 *  unique index on razorpay_payment_id makes crediting twice a no-op. */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')

    const body = (await request.json().catch(() => null)) as PostBody | null
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = body ?? {}
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || typeof amount !== 'number') {
      return NextResponse.json({ error: 'Missing payment verification fields' }, { status: 400 })
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET
    if (!keySecret) {
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

    const admin = supabaseAdmin()
    const { data, error } = await admin.rpc('credit_wallet', {
      p_account_id: accountId,
      p_amount: amount,
      p_razorpay_payment_id: razorpay_payment_id,
      p_razorpay_order_id: razorpay_order_id,
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

    return NextResponse.json({ credited: true, newBalance: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
