// ============================================================
// Impersonation session cookie — "Login as Client" support.
//
// While a platform admin is viewing the app as a tenant's owner, the
// browser's Supabase auth cookies hold the TARGET user's session (so
// every RLS check in the app behaves exactly as it would for that
// user). The admin's own session tokens are stashed here so "Return
// to admin" can restore them without a second login.
//
// Encrypted with the same AES-256-GCM helper already used for
// WhatsApp tokens — no new crypto primitive for one more secret blob.
// ============================================================

import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

export const IMPERSONATION_COOKIE = 'gs_impersonation_session'

// Safety cap on how long a support session can stay swapped in, even
// if nobody clicks "Return to admin". Independent of Supabase's own
// token expiry — this just bounds how long the banner (and the stashed
// admin session) survives before the cookie is dropped by the browser.
const MAX_AGE_SECONDS = 60 * 60 * 4

export interface ImpersonationPayload {
  logId: string;
  accountId: string;
  accountName: string;
  adminAccessToken: string;
  adminRefreshToken: string;
}

function isImpersonationPayload(value: unknown): value is ImpersonationPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.logId === 'string' &&
    typeof v.accountId === 'string' &&
    typeof v.accountName === 'string' &&
    typeof v.adminAccessToken === 'string' &&
    typeof v.adminRefreshToken === 'string'
  );
}

/** Encrypts the payload for storage in the httpOnly impersonation cookie. */
export function encodeImpersonationCookie(payload: ImpersonationPayload): string {
  return encrypt(JSON.stringify(payload));
}

/**
 * Decrypts + parses the cookie value. Returns `null` for anything
 * missing, tampered, or shaped wrong rather than throwing — callers
 * treat that identically to "not currently impersonating".
 */
export function decodeImpersonationCookie(
  raw: string | undefined | null,
): ImpersonationPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decrypt(raw));
    return isImpersonationPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function impersonationCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  };
}
