// ============================================================
// Meta's WhatsApp messaging-limit tiers — the cap on
// business-initiated conversations (template sends to a contact with
// no open 24h window) an account can start per rolling 24 hours. See
// Meta's Messaging Limits doc. `whatsapp_config.messaging_limit_tier`
// is synced from Meta only when a user hits "Refresh Status"
// (src/app/api/whatsapp/config/refresh/route.ts) — there's no cron
// keeping it current.
//
// Single source of truth for both the read-only display in Settings
// (whatsapp-management.tsx) and the daily-quota send guard
// (daily-quota.ts), so the two can't drift apart.
// ============================================================

export const MESSAGING_LIMIT_TIER_CAP: Record<string, number | null> = {
  TIER_250: 250,
  TIER_2K: 2000,
  TIER_10K: 10000,
  TIER_100K: 100000,
  TIER_UNLIMITED: null, // no cap
};

/** Numeric daily cap for a tier, or null if unknown/unlimited/unsynced. */
export function dailyCapForTier(tier: string | null | undefined): number | null {
  if (!tier) return null;
  return MESSAGING_LIMIT_TIER_CAP[tier] ?? null;
}

/** Human-readable tier label for display, e.g. "2,000 / day". */
export function formatMessagingLimit(tier: string | null | undefined): string {
  if (!tier) return '—';
  if (tier === 'TIER_UNLIMITED') return 'Unlimited';
  const cap = MESSAGING_LIMIT_TIER_CAP[tier];
  return cap == null ? tier : `${cap.toLocaleString()} / day`;
}
