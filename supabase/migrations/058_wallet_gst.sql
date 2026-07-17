-- ============================================================
-- 058_wallet_gst.sql — 18% GST on wallet recharges
--
-- Razorpay has no built-in GST field, so GST is computed and added
-- manually in application code (createRazorpayOrder callers in
-- src/app/api/billing/recharge) before the order is created. Only the
-- base amount is ever credited to accounts.wallet_balance — GST is
-- tracked on the wallet_transactions ledger row for accounting only,
-- it is never spendable balance.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS total_paid NUMERIC(12,2);

COMMENT ON COLUMN wallet_transactions.gst_amount IS
  '18% GST charged on top of `amount` for this recharge, collected via Razorpay but not credited to wallet_balance. 0 for message_charge rows.';
COMMENT ON COLUMN wallet_transactions.total_paid IS
  'Actual amount captured by Razorpay for a recharge (amount + gst_amount). NULL for message_charge rows.';

-- ============================================================
-- credit_wallet — extended with GST bookkeeping params. A 4-arg and a
-- 6-arg function with the same name would be two distinct overloads
-- in Postgres (it dispatches on the full type list, not just the
-- name), and PostgREST/supabase-js's .rpc() calls would then become
-- ambiguous whenever only the original 4 named args are passed — so
-- the old 4-arg overload is dropped outright rather than left beside
-- this one. wallet_balance still only ever moves by p_amount (the
-- base, pre-GST amount) — p_gst_amount/p_total_paid are recorded on
-- the ledger row purely for accounting.
-- ============================================================
DROP FUNCTION IF EXISTS public.credit_wallet(UUID, NUMERIC, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_account_id UUID,
  p_amount NUMERIC,
  p_razorpay_payment_id TEXT,
  p_razorpay_order_id TEXT DEFAULT NULL,
  p_gst_amount NUMERIC DEFAULT 0,
  p_total_paid NUMERIC DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  UPDATE accounts
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_account_id
  RETURNING wallet_balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'account % not found', p_account_id;
  END IF;

  INSERT INTO wallet_transactions
    (account_id, type, amount, razorpay_payment_id, razorpay_order_id, balance_after, gst_amount, total_paid)
  VALUES
    (p_account_id, 'recharge', p_amount, p_razorpay_payment_id, p_razorpay_order_id, v_new_balance,
     p_gst_amount, COALESCE(p_total_paid, p_amount + p_gst_amount));

  RETURN v_new_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_wallet(UUID, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_wallet(UUID, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC) TO authenticated, service_role;
