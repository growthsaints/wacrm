// ============================================================
// Minimal Razorpay REST client — no SDK dependency, same approach as
// the commerce integrations (plain fetch + Web Crypto HMAC
// verification, see src/lib/commerce/woocommerce.ts).
//
// Razorpay's API auth is HTTP Basic with keyId as the username and
// keySecret as the password. Signatures (both the client-side
// checkout-success payload and inbound webhooks) are hex HMAC-SHA256
// — unlike WooCommerce/Shopify's base64 — so this has its own
// verify helper rather than reusing theirs.
// ============================================================

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';

function basicAuthHeader(keyId: string, keySecret: string): string {
  return 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Buffer.from(sig).toString('hex');
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

/** Creates a Razorpay order for a one-time wallet recharge. Amount is
 *  in whole rupees; Razorpay's API wants paise (integer, ×100).
 *  `accountId` is stashed in `notes` so the webhook — which only ever
 *  sees the Razorpay order/payment entities, not our own request
 *  context — knows which account's wallet to credit. Extra `notes`
 *  (e.g. the base/GST split) are merged in and get copied onto the
 *  resulting payment entity by Razorpay, so verify/webhook can read
 *  them back without trusting anything client-supplied. */
export async function createRazorpayOrder(args: {
  keyId: string;
  keySecret: string;
  amountRupees: number;
  receipt: string;
  accountId: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  const response = await fetch(`${RAZORPAY_API_BASE}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: basicAuthHeader(args.keyId, args.keySecret),
    },
    body: JSON.stringify({
      amount: Math.round(args.amountRupees * 100),
      currency: 'INR',
      receipt: args.receipt,
      payment_capture: 1,
      notes: { account_id: args.accountId, purpose: 'wallet_recharge', ...args.notes },
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Razorpay order creation failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return { id: data.id, amount: data.amount, currency: data.currency };
}

export interface RazorpayPayment {
  id: string;
  orderId: string | null;
  amount: number;
  status: string;
  notes: Record<string, string>;
}

/** Fetches a payment straight from Razorpay by id — the authoritative
 *  source for what was actually captured, used by the verify route
 *  instead of trusting client-supplied amount/notes. */
export async function fetchRazorpayPayment(args: {
  keyId: string;
  keySecret: string;
  paymentId: string;
}): Promise<RazorpayPayment> {
  const response = await fetch(`${RAZORPAY_API_BASE}/payments/${args.paymentId}`, {
    headers: { Authorization: basicAuthHeader(args.keyId, args.keySecret) },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Razorpay payment lookup failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return {
    id: data.id,
    orderId: data.order_id ?? null,
    amount: data.amount,
    status: data.status,
    notes: (data.notes as Record<string, string>) ?? {},
  };
}

export interface RazorpaySubscription {
  id: string;
  status: string;
  /** Razorpay-hosted payment page — can be sent to a customer directly
   *  without building a Checkout.js page (used for the Managed plan's
   *  one-off ₹4500 charge, sent by Super Admin). */
  shortUrl: string | null;
}

/** Creates a Razorpay Subscription against a pre-created Plan.
 *  `totalCount` controls how many billing cycles it runs for —
 *  1 for the Managed plan's single ₹4500 charge (no auto-renewal),
 *  120 (effectively indefinite) for the self-serve monthly/quarterly
 *  plans, which keep renewing until the customer or account cancels. */
export async function createRazorpaySubscription(args: {
  keyId: string;
  keySecret: string;
  planId: string;
  accountId: string;
  totalCount: number;
}): Promise<RazorpaySubscription> {
  const response = await fetch(`${RAZORPAY_API_BASE}/subscriptions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: basicAuthHeader(args.keyId, args.keySecret),
    },
    body: JSON.stringify({
      plan_id: args.planId,
      customer_notify: 1,
      total_count: args.totalCount,
      notes: { account_id: args.accountId },
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Razorpay subscription creation failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return { id: data.id, status: data.status, shortUrl: data.short_url ?? null };
}

/** Verifies the signature Razorpay Checkout returns on successful
 *  payment (razorpay_order_id, razorpay_payment_id, razorpay_signature).
 *  This is the client-facing confirmation path — the webhook below is
 *  the authoritative server-to-server one. */
export async function verifyRazorpayPaymentSignature(args: {
  keySecret: string;
  orderId: string;
  paymentId: string;
  signature: string;
}): Promise<boolean> {
  const expected = await hmacSha256Hex(args.keySecret, `${args.orderId}|${args.paymentId}`);
  return expected === args.signature;
}

/** Verifies the X-Razorpay-Signature header on an inbound webhook. */
export async function verifyRazorpayWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string
): Promise<boolean> {
  if (!signatureHeader) return false;
  const expected = await hmacSha256Hex(webhookSecret, rawBody);
  return expected === signatureHeader;
}
