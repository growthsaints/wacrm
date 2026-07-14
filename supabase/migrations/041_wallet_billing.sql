-- ============================================================
-- 041_wallet_billing.sql — Prepaid wallet billing for WhatsApp usage
--
-- Growth Saints CRM charges accounts per WhatsApp template message
-- sent, based on Meta's conversation-category pricing (Marketing /
-- Utility / Authentication — free-form "Service" replies within an
-- open session are not charged). Accounts prepay into a wallet via
-- Razorpay and each billable send debits it atomically.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ============================================================
-- WALLET_TRANSACTIONS — append-only ledger. 'recharge' rows are
-- credits (positive amount) from a completed Razorpay payment;
-- 'message_charge' rows are debits (negative amount) for a billable
-- template send. `balance_after` is a snapshot so the Billing page's
-- history list never has to recompute a running total.
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type                  TEXT NOT NULL CHECK (type IN ('recharge', 'message_charge')),
  amount                NUMERIC(12,2) NOT NULL,
  conversation_category TEXT CHECK (conversation_category IN ('marketing', 'utility', 'authentication', 'service')),
  message_id            UUID REFERENCES messages(id) ON DELETE SET NULL,
  razorpay_payment_id   TEXT,
  razorpay_order_id     TEXT,
  balance_after         NUMERIC(12,2) NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_account
  ON wallet_transactions(account_id, created_at DESC);

-- De-dupe recharge credits if a Razorpay webhook fires more than once
-- for the same payment (Razorpay's own retry behavior).
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_transactions_razorpay_payment
  ON wallet_transactions(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;

ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallet_transactions_select ON wallet_transactions;
CREATE POLICY wallet_transactions_select ON wallet_transactions FOR SELECT
  USING (is_account_member(account_id));
-- No client INSERT/UPDATE/DELETE policy — writes only happen through
-- the charge_wallet / credit_wallet SECURITY DEFINER functions below.

-- ============================================================
-- charge_wallet — atomically debit an account's wallet for one
-- billable WhatsApp send. The UPDATE itself row-locks the account
-- for the duration of the transaction, so concurrent sends across
-- multiple requests can't race past a balance check. Returns FALSE
-- (and leaves the balance untouched) if the account no longer exists;
-- callers are expected to have already confirmed sufficient balance
-- via a prior check, so going negative here is treated as an accepted
-- edge case (e.g. a rate change between check and charge) rather than
-- blocked — the message has already been sent to Meta by this point.
-- ============================================================
CREATE OR REPLACE FUNCTION public.charge_wallet(
  p_account_id UUID,
  p_amount NUMERIC,
  p_category TEXT,
  p_message_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  UPDATE accounts
  SET wallet_balance = wallet_balance - p_amount
  WHERE id = p_account_id
  RETURNING wallet_balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RETURN FALSE;
  END IF;

  INSERT INTO wallet_transactions
    (account_id, type, amount, conversation_category, message_id, balance_after)
  VALUES
    (p_account_id, 'message_charge', -p_amount, p_category, p_message_id, v_new_balance);

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.charge_wallet(UUID, NUMERIC, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.charge_wallet(UUID, NUMERIC, TEXT, UUID) TO authenticated, service_role;

-- ============================================================
-- credit_wallet — atomically credit an account's wallet from a
-- completed Razorpay payment. The unique index on razorpay_payment_id
-- above makes this safe to call twice for the same payment (e.g. both
-- the client-side verify call and the webhook firing) — the second
-- INSERT raises a unique-violation, which the caller catches and
-- treats as already-credited rather than double-crediting.
-- ============================================================
CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_account_id UUID,
  p_amount NUMERIC,
  p_razorpay_payment_id TEXT,
  p_razorpay_order_id TEXT DEFAULT NULL
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
    (account_id, type, amount, razorpay_payment_id, razorpay_order_id, balance_after)
  VALUES
    (p_account_id, 'recharge', p_amount, p_razorpay_payment_id, p_razorpay_order_id, v_new_balance);

  RETURN v_new_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_wallet(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_wallet(UUID, NUMERIC, TEXT, TEXT) TO authenticated, service_role;
