import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone, phonesMatch } from "@/lib/whatsapp/phone-utils";

/**
 * Contact de-duplication helpers, shared by the WhatsApp webhook, the
 * manual contact form, and CSV import so all paths agree on what
 * "same number" means (issue #212).
 *
 * The canonical key is `normalizePhone` (digits-only) — the same form
 * the DB stores in the generated `contacts.phone_normalized` column
 * and enforces unique per account. `phonesMatch` adds trunk-prefix
 * tolerance (last-8-digit match) for the softer "possible duplicate"
 * surfaces.
 */

/** Canonical de-dup key for a phone string (digits only). */
export function normalizeKey(phone: string): string {
  return normalizePhone(phone);
}

/** Minimal shape we need back from a contacts lookup. */
export interface ExistingContact {
  id: string;
  phone: string;
  name?: string | null;
  [key: string]: unknown;
}

/**
 * Find an existing contact in `accountId` whose phone matches `phone`,
 * or null. Pre-filters in SQL by the last-8-digit suffix (so we don't
 * pull every contact), then applies the strict `phonesMatch` in JS on
 * the small candidate set — the exact approach the webhook has used.
 */
export async function findExistingContact(
  db: SupabaseClient,
  accountId: string,
  phone: string,
): Promise<ExistingContact | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;

  const { data, error } = await db
    .from("contacts")
    .select("*")
    .eq("account_id", accountId)
    .like("phone", `%${suffix}`);

  if (error || !data) return null;

  return (
    (data as ExistingContact[]).find((c) => phonesMatch(c.phone, phone)) ?? null
  );
}

/**
 * True when an existing contact is an *exact* normalized match for
 * `phone` (vs only a fuzzy trunk-variant match). The form hard-blocks
 * exact matches but only warns on fuzzy ones.
 */
export function isExactMatch(existing: ExistingContact, phone: string): boolean {
  return normalizeKey(existing.phone) === normalizeKey(phone);
}

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505).
 * Used as the backstop when the DB unique index rejects a racing or
 * format-equal insert that slipped past the in-app check.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "23505";
}

const EXISTING_PHONES_PAGE_SIZE = 1000;

/**
 * Fetches every existing contact's (id, phone_normalized) for an
 * account, paginating past Supabase/PostgREST's default 1,000-row cap
 * on an unbounded `.select()`. Used by CSV import to decide insert vs.
 * update per row — without paginating, an account with more than
 * 1,000 existing contacts would silently only see the first 1,000,
 * misclassifying the rest as "new," which then fail on the DB's
 * unique-phone constraint and fall back to the much slower
 * one-row-at-a-time retry path. This is the same truncation bug
 * already fixed for Meta Ads Custom Audiences (lib/meta-ads/audience.ts).
 */
export async function fetchExistingPhonesByAccount(
  db: SupabaseClient,
  accountId: string,
): Promise<Map<string, string>> {
  const existingIdByPhone = new Map<string, string>();
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("contacts")
      .select("id, phone_normalized")
      .eq("account_id", accountId)
      .range(from, from + EXISTING_PHONES_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { id: string; phone_normalized: string | null }[];
    for (const row of rows) {
      if (row.phone_normalized) existingIdByPhone.set(row.phone_normalized, row.id);
    }
    if (rows.length < EXISTING_PHONES_PAGE_SIZE) break;
    from += EXISTING_PHONES_PAGE_SIZE;
  }
  return existingIdByPhone;
}

/**
 * De-duplicate parsed CSV rows by normalized phone, keeping the first
 * occurrence of each. Rows with an empty normalized phone are dropped
 * (they can't be a valid contact). Returns the unique rows plus the
 * count removed as in-file duplicates.
 */
export function dedupeByPhone<T extends { phone: string }>(
  rows: T[],
): { unique: T[]; duplicates: number } {
  const seen = new Set<string>();
  const unique: T[] = [];
  let duplicates = 0;

  for (const row of rows) {
    const key = normalizeKey(row.phone);
    if (!key) {
      duplicates++;
      continue;
    }
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }

  return { unique, duplicates };
}
