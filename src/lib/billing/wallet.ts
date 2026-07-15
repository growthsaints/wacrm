import type { SupabaseClient } from '@supabase/supabase-js';
import { categoryFromTemplate, rateForCategory, type ConversationCategory } from '@/lib/billing/rates';

export class WalletError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'WalletError';
    this.code = code;
  }
}

/**
 * Looks up a template's billing category by name. Callers that already
 * have the template row loaded (send-message.ts, broadcast-core.ts)
 * should read `.category` off it directly via `categoryFromTemplate`
 * instead of calling this — it's for the engine call sites
 * (automations/flows) that only carry a template name.
 */
export async function resolveTemplateCategory(
  db: SupabaseClient,
  accountId: string,
  templateName: string,
  templateLanguage?: string
): Promise<ConversationCategory> {
  const { data } = await db
    .from('message_templates')
    .select('category')
    .eq('account_id', accountId)
    .eq('name', templateName)
    .eq('language', templateLanguage || 'en_US')
    .maybeSingle();
  return categoryFromTemplate(
    (data as { category?: string } | null)?.category
  );
}

/**
 * Throws WalletError('insufficient_balance', …) if the account can't
 * cover one send in this category. No-op for 'service' (free) sends —
 * skips the read entirely so free-form replies never touch billing.
 */
export async function ensureWalletBalance(
  db: SupabaseClient,
  accountId: string,
  category: ConversationCategory
): Promise<void> {
  const rate = rateForCategory(category);
  if (rate === 0) return;

  const { data, error } = await db
    .from('accounts')
    .select('wallet_balance')
    .eq('id', accountId)
    .single();

  if (error || !data) {
    throw new WalletError(
      'wallet_lookup_failed',
      'Could not verify wallet balance before sending.'
    );
  }

  const balance = Number((data as { wallet_balance: number }).wallet_balance);
  if (balance < rate) {
    throw new WalletError(
      'insufficient_balance',
      `Insufficient wallet balance: current balance is ₹${balance.toFixed(2)}. Please recharge in Settings → Billing.`
    );
  }
}

/**
 * Debits the wallet for one successful billable send. Best-effort —
 * the message has already reached Meta by the time this runs, so a
 * failure here is logged rather than thrown (never undo a real send
 * over a billing-ledger write failure).
 */
export async function chargeWalletForSend(
  db: SupabaseClient,
  accountId: string,
  category: ConversationCategory,
  messageId?: string | null
): Promise<void> {
  const rate = rateForCategory(category);
  if (rate === 0) return;

  const { error } = await db.rpc('charge_wallet', {
    p_account_id: accountId,
    p_amount: rate,
    p_category: category,
    p_message_id: messageId ?? null,
  });
  if (error) {
    console.error('[wallet] charge_wallet failed:', error.message);
  }
}
