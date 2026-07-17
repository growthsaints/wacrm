// ============================================================
// Conversation-category pricing for wallet billing.
//
// Meta bills a WhatsApp Business Account per conversation, categorized
// by the template that opened it. Free-form replies within an open
// 24-hour customer-service window ("Service" category) are not
// separately billed by Meta in India, so we pass that through as free.
//
// Rates are INR, in whole rupees (not paise) — matches the wallet
// column's NUMERIC(12,2) unit.
// ============================================================

export const CONVERSATION_RATES = {
  marketing: 1.16,
  utility: 0.75,
  authentication: 0.3,
  service: 0,
} as const;

export type ConversationCategory = keyof typeof CONVERSATION_RATES;

export const MIN_RECHARGE_AMOUNT = 1500;

// Razorpay has no built-in GST field, so it's applied manually here on
// top of the base amount before creating the order — the base amount
// is what actually lands in wallet_balance, GST is tracked separately
// in wallet_transactions for accounting only.
export const GST_RATE = 0.18;

export function gstAmount(baseAmount: number): number {
  return Math.round(baseAmount * GST_RATE * 100) / 100;
}

export function totalWithGst(baseAmount: number): number {
  return Math.round((baseAmount + gstAmount(baseAmount)) * 100) / 100;
}

/**
 * Maps a message_templates.category value ('Marketing' | 'Utility' |
 * 'Authentication', per template-sync.ts's normalizeCategory) to a
 * billing category. Anything missing/unrecognized (no template row,
 * a plain text/media/interactive send) is 'service' — free.
 */
export function categoryFromTemplate(
  templateCategory: string | null | undefined
): ConversationCategory {
  if (!templateCategory) return 'service';
  const lower = templateCategory.toLowerCase();
  if (lower === 'marketing') return 'marketing';
  if (lower === 'utility') return 'utility';
  if (lower === 'authentication') return 'authentication';
  return 'service';
}

export function rateForCategory(category: ConversationCategory): number {
  return CONVERSATION_RATES[category];
}
