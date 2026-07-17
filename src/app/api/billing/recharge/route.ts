import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createRazorpayOrder } from '@/lib/billing/razorpay-client'
import { MIN_RECHARGE_AMOUNT, gstAmount, totalWithGst } from '@/lib/billing/rates'

interface PostBody {
  amount?: number
}

/** POST /api/billing/recharge — creates a Razorpay order for a wallet
 *  top-up. Razorpay has no native GST field, so 18% GST is added here
 *  on top of the requested amount before the order is created; only
 *  the base amount is ever credited to wallet_balance (see verify/
 *  route.ts and the webhook), the GST portion is tracked purely for
 *  accounting. The frontend opens Razorpay Checkout with the returned
 *  order id; on success it calls /api/billing/recharge/verify, and the
 *  webhook (/api/webhooks/razorpay) is the authoritative fallback. */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('owner')

    const body = (await request.json().catch(() => null)) as PostBody | null
    const amount = body?.amount
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < MIN_RECHARGE_AMOUNT) {
      return NextResponse.json(
        { error: `Minimum recharge amount is ₹${MIN_RECHARGE_AMOUNT}` },
        { status: 400 },
      )
    }

    const keyId = process.env.RAZORPAY_KEY_ID
    const keySecret = process.env.RAZORPAY_KEY_SECRET
    if (!keyId || !keySecret) {
      return NextResponse.json(
        { error: 'Razorpay is not configured on this server.' },
        { status: 500 },
      )
    }

    const gst = gstAmount(amount)
    const totalPayable = totalWithGst(amount)

    // Razorpay caps `receipt` at 40 chars — a full UUID + timestamp
    // blows past that, so use only the account id's first 8 chars
    // (this is just our own reference string, not looked up by it).
    const order = await createRazorpayOrder({
      keyId,
      keySecret,
      amountRupees: totalPayable,
      receipt: `wr_${accountId.slice(0, 8)}_${Date.now()}`,
      accountId,
      notes: {
        base_amount: amount.toFixed(2),
        gst_amount: gst.toFixed(2),
      },
    })

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
      baseAmount: amount,
      gstAmount: gst,
      totalAmount: totalPayable,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
