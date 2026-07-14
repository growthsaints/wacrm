import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { MIN_RECHARGE_AMOUNT, CONVERSATION_RATES } from '@/lib/billing/rates'

/** GET /api/billing/wallet — current balance, recent transactions,
 *  and the rate card, for the Settings → Billing page. */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer')

    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('wallet_balance')
      .eq('id', accountId)
      .single()
    if (accountError || !account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const { data: transactions, error: txError } = await supabase
      .from('wallet_transactions')
      .select('id, type, amount, conversation_category, balance_after, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (txError) {
      return NextResponse.json({ error: txError.message }, { status: 500 })
    }

    return NextResponse.json({
      balance: account.wallet_balance,
      minRechargeAmount: MIN_RECHARGE_AMOUNT,
      rates: CONVERSATION_RATES,
      transactions: transactions ?? [],
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
