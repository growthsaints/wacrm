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
 *  context — knows which account's wallet to credit. */
export async function createRazorpayOrder(args: {
  keyId: string;
  keySecret: string;
  amountRupees: number;
  receipt: string;
  accountId: string;
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
      notes: { account_id: args.accountId, purpose: 'wallet_recharge' },
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Razorpay order creation failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return { id: data.id, amount: data.amount, currency: data.currency };
}

export interface RazorpaySubscription {
  id: string;
  status: string;
}

/** Creates a recurring Razorpay Subscription against a pre-created
 *  Plan (monthly ₹1200 or quarterly ₹3000 — see docs/production-
 *  deployment-checklist.md for the Plan IDs). No `total_count` means
 *  it renews indefinitely until the customer or account cancels it. */
export async function createRazorpaySubscription(args: {
  keyId: string;
  keySecret: string;
  planId: string;
  accountId: string;
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
      total_count: 120, // Razorpay requires a cap; 120 cycles is effectively indefinite (10yr monthly / 30yr quarterly).
      notes: { account_id: args.accountId },
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Razorpay subscription creation failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return { id: data.id, status: data.status };
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
