-- ============================================================
-- 059_invoices.sql — GST invoices for wallet recharges and self-serve
-- subscription payments.
--
-- Every payment that already exists in the system (wallet_transactions
-- 'recharge' rows, and Razorpay subscription.charged webhook events)
-- gets a matching row here with a sequential invoice number, so
-- Settings → Billing can offer a "Download invoice" PDF per payment.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  invoice_number      TEXT NOT NULL UNIQUE,
  invoice_type        TEXT NOT NULL CHECK (invoice_type IN ('wallet_recharge', 'subscription')),
  description         TEXT NOT NULL,
  base_amount         NUMERIC(12,2) NOT NULL,
  gst_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount        NUMERIC(12,2) NOT NULL,
  razorpay_payment_id TEXT,
  razorpay_order_id   TEXT,
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_account
  ON invoices(account_id, issued_at DESC);

-- De-dupe if the webhook and another path both try to invoice the same
-- captured payment (same idempotency pattern as
-- idx_wallet_transactions_razorpay_payment in migration 041).
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_razorpay_payment_type
  ON invoices(razorpay_payment_id, invoice_type) WHERE razorpay_payment_id IS NOT NULL;

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_select ON invoices;
CREATE POLICY invoices_select ON invoices FOR SELECT
  USING (is_account_member(account_id));
-- No client INSERT/UPDATE/DELETE policy — writes only happen through
-- create_invoice below (service-role/SECURITY DEFINER).

-- ============================================================
-- invoice_counters + next_invoice_number — atomic sequential
-- numbering per prefix (e.g. 'GS/2026'), so concurrent invoice
-- creation can't race into a duplicate or skipped number the way a
-- plain "SELECT MAX(...) + 1" in application code could.
-- ============================================================
CREATE TABLE IF NOT EXISTS invoice_counters (
  prefix      TEXT PRIMARY KEY,
  next_number INTEGER NOT NULL DEFAULT 1
);

CREATE OR REPLACE FUNCTION public.next_invoice_number(p_prefix TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_number INTEGER;
BEGIN
  INSERT INTO invoice_counters (prefix, next_number)
  VALUES (p_prefix, 2)
  ON CONFLICT (prefix) DO UPDATE SET next_number = invoice_counters.next_number + 1
  RETURNING next_number - 1 INTO v_number;

  RETURN p_prefix || '/' || LPAD(v_number::TEXT, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_invoice_number(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(TEXT) TO authenticated, service_role;

-- ============================================================
-- create_invoice — inserts one invoice row with an auto-assigned
-- number. Callers (recharge verify/webhook, subscription webhook)
-- catch a unique-violation on (razorpay_payment_id, invoice_type) the
-- same way credit_wallet's callers already catch one on
-- razorpay_payment_id — it means this payment was already invoiced by
-- the other path (verify vs. webhook racing each other).
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_invoice(
  p_account_id UUID,
  p_invoice_type TEXT,
  p_description TEXT,
  p_base_amount NUMERIC,
  p_gst_amount NUMERIC,
  p_total_amount NUMERIC,
  p_razorpay_payment_id TEXT DEFAULT NULL,
  p_razorpay_order_id TEXT DEFAULT NULL,
  p_prefix TEXT DEFAULT 'GS/2026'
)
RETURNS invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice invoices;
BEGIN
  INSERT INTO invoices
    (account_id, invoice_number, invoice_type, description, base_amount, gst_amount, total_amount, razorpay_payment_id, razorpay_order_id)
  VALUES
    (p_account_id, next_invoice_number(p_prefix), p_invoice_type, p_description, p_base_amount, p_gst_amount, p_total_amount, p_razorpay_payment_id, p_razorpay_order_id)
  RETURNING * INTO v_invoice;

  RETURN v_invoice;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice(UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invoice(UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) TO authenticated, service_role;
