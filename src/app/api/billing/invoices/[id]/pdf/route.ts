import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { renderInvoicePdf } from '@/lib/billing/invoice-pdf'
import type { InvoiceRow } from '@/lib/billing/invoices'

export const runtime = 'nodejs'

/** GET /api/billing/invoices/[id]/pdf — streams a single invoice as a
 *  PDF. Scoped to the caller's own account via the invoices_select RLS
 *  policy, same as the list route — a stray id from another account
 *  just 404s. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('owner')
    const { id } = await params

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const { data: account } = await supabase
      .from('accounts')
      .select('name')
      .eq('id', accountId)
      .single()

    const pdf = await renderInvoicePdf(invoice as InvoiceRow, (account as { name?: string } | null)?.name ?? 'Customer')

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${(invoice as InvoiceRow).invoice_number.replace(/\//g, '-')}.pdf"`,
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
