// Issuer details printed on every generated GST invoice. There's no
// per-customer GSTIN captured anywhere yet, so invoices only carry the
// issuer's GST details — add a billing_gstin/billing_address column
// to accounts if per-customer GSTIN capture is ever needed.
export const INVOICE_ISSUER = {
  legalName: 'GROWTH SAINTS',
  gstin: '09BOYPA2068F2ZO',
  address: 'Noida, Uttar Pradesh, India',
} as const;

export const INVOICE_NUMBER_PREFIX = 'GS/2026';
