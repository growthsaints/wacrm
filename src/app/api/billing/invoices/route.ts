import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/** GET /api/billing/invoices — invoice history for Settings → Billing,
 *  newest first. PDF for a given row is at
 *  /api/billing/invoices/[id]/pdf. */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('owner')

    const { data, error } = await supabase
      .from('invoices')
      .select('id, invoice_number, invoice_type, description, base_amount, gst_amount, total_amount, issued_at')
      .eq('account_id', accountId)
      .order('issued_at', { ascending: false })
      .limit(100)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ invoices: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
