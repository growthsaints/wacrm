import type { SupabaseClient } from '@supabase/supabase-js';
import { INVOICE_NUMBER_PREFIX } from './invoice-config';

export type InvoiceType = 'wallet_recharge' | 'subscription';

export interface InvoiceRow {
  id: string;
  account_id: string;
  invoice_number: string;
  invoice_type: InvoiceType;
  description: string;
  base_amount: number;
  gst_amount: number;
  total_amount: number;
  razorpay_payment_id: string | null;
  razorpay_order_id: string | null;
  issued_at: string;
}

/**
 * Records an invoice for a completed payment. Safe to call twice for
 * the same razorpayPaymentId + invoiceType (e.g. the client verify
 * call and the webhook both firing for one recharge) — the unique
 * index on (razorpay_payment_id, invoice_type) turns the second
 * attempt into a caught 23505, and this returns the existing row
 * instead of creating a duplicate invoice number.
 */
export async function recordInvoice(
  db: SupabaseClient,
  args: {
    accountId: string;
    invoiceType: InvoiceType;
    description: string;
    baseAmount: number;
    gstAmount: number;
    totalAmount: number;
    razorpayPaymentId?: string | null;
    razorpayOrderId?: string | null;
  },
): Promise<InvoiceRow | null> {
  const { data, error } = await db.rpc('create_invoice', {
    p_account_id: args.accountId,
    p_invoice_type: args.invoiceType,
    p_description: args.description,
    p_base_amount: args.baseAmount,
    p_gst_amount: args.gstAmount,
    p_total_amount: args.totalAmount,
    p_razorpay_payment_id: args.razorpayPaymentId ?? null,
    p_razorpay_order_id: args.razorpayOrderId ?? null,
    p_prefix: INVOICE_NUMBER_PREFIX,
  });

  if (error) {
    if (error.code === '23505' && args.razorpayPaymentId) {
      const { data: existing } = await db
        .from('invoices')
        .select('*')
        .eq('razorpay_payment_id', args.razorpayPaymentId)
        .eq('invoice_type', args.invoiceType)
        .maybeSingle();
      return (existing as InvoiceRow | null) ?? null;
    }
    console.error('[invoices] create_invoice failed:', error.message);
    return null;
  }

  return data as InvoiceRow;
}
