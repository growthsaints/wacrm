// ============================================================
// Embedded Signup — pure, unit-testable logic.
//
// Everything here is dependency-free (no Supabase, no fetch) so the
// completion route (src/app/api/whatsapp/embedded-signup/complete/route.ts)
// and the management UI can share one source of truth for "what PIN do
// we set", "is this number healthy", and "how do we explain this Meta
// error to a non-technical user" without duplicating logic.
// ============================================================

import { randomInt } from 'crypto';

/**
 * A brand-new number connected through Embedded Signup has no 2FA PIN
 * yet, so we set one ourselves as part of automatic setup — the user
 * is never asked for it (this is exactly how AiSensy/WATI/Interakt-
 * style zero-touch onboarding works). The PIN itself has no further
 * significance once /register succeeds and is never persisted.
 */
export function generateRegistrationPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * True when a Meta /register failure means the number already has a
 * DIFFERENT 2FA PIN set (typically an existing number being migrated
 * in with 2FA the client configured elsewhere) — as opposed to some
 * other, unrelated failure. Distinguishing this matters because it's
 * the one case where automatic setup genuinely cannot proceed without
 * the client's own PIN, and the UI should point them at the existing
 * manual "Advanced setup" PIN field rather than suggesting a generic
 * retry.
 */
export function isPinMismatchError(message: string): boolean {
  return /incorrect pin|pin.*(mismatch|incorrect|invalid)|two-step verification pin required/i.test(
    message,
  );
}

/** True when Meta's authorization code has expired or was already redeemed. */
export function isExpiredCodeError(message: string): boolean {
  return /expired|invalid.*code|code.*(invalid|has been used)/i.test(message);
}

/** True when the granted Facebook Login scopes are missing what we need. */
export function isPermissionError(message: string): boolean {
  return /permission|scope|not authorized|insufficient/i.test(message);
}

/**
 * Maps a raw Meta/Graph API error message to a short, non-technical
 * string safe to show a business owner who has never heard of the
 * Graph API. Falls back to the raw message for anything unrecognized
 * (still safe — Meta's own messages are human-readable, just often
 * more technical than we'd like).
 */
export function describeEmbeddedSignupError(message: string): string {
  if (isExpiredCodeError(message)) {
    return 'That connection attempt expired. Please click Connect WhatsApp again.';
  }
  if (isPinMismatchError(message)) {
    return 'This number already has security verification set up elsewhere. Use Advanced setup to enter its verification PIN, or contact support.';
  }
  if (isPermissionError(message)) {
    return 'Facebook did not grant the permissions WhatsApp needs. Please try again and accept all requested permissions.';
  }
  return message;
}

export type WhatsAppHealthStatus = 'healthy' | 'action_needed' | 'disconnected';

export interface HealthStatusInput {
  hasConfig: boolean;
  registeredAt: string | null;
  qualityRating: string | null;
  lastRegistrationError: string | null;
}

/**
 * Single source of truth for the traffic-light shown in both the
 * client's WhatsApp Management panel and the Super Admin dashboard.
 * Kept a pure function of stored fields (never a live Meta call) so
 * it renders instantly and consistently in both places.
 */
export function computeHealthStatus(input: HealthStatusInput): WhatsAppHealthStatus {
  if (!input.hasConfig) return 'disconnected';
  if (!input.registeredAt || input.lastRegistrationError) return 'action_needed';
  if (input.qualityRating === 'RED') return 'action_needed';
  return 'healthy';
}
