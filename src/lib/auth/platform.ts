// ============================================================
// Platform-admin auth — the Growth Saints operator identity.
//
// Distinct from `AccountRole` (owner/admin/agent/viewer, ./roles.ts):
// a platform admin is not a member of any tenant account. Membership
// lives in `platform_admins` (migration 037), readable by any
// authenticated user for their own row (the cheap "am I one?" check)
// and by existing platform admins for the full roster (Settings →
// Platform admins). Mirrors the shape of `getCurrentAccount()` /
// `requireRole()` in `./account.ts` so both admin layers read the
// same way and share the same error → HTTP status mapping.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/account";
import { platformAdminClient } from "@/lib/platform/admin-client";

export interface PlatformAdminContext {
  /** RLS-scoped SSR client for the calling platform admin's own session. */
  supabase: SupabaseClient;
  userId: string;
  email: string | null;
}

/** Pure — parses the bootstrap allow-list into a lowercase email set. */
export function parseBootstrapEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Pure — true if `email` is on the operator-configured bootstrap list. */
export function isBootstrapEmail(
  email: string | null | undefined,
  raw: string | undefined,
): boolean {
  if (!email) return false;
  return parseBootstrapEmails(raw).includes(email.toLowerCase());
}

/**
 * Resolve platform-admin context for the current request.
 *
 * Throws `UnauthorizedError` with no session, `ForbiddenError` when
 * signed in but not a platform admin.
 *
 * First-run bootstrap: if the signed-in user's email is on the
 * operator-configured `PLATFORM_ADMIN_BOOTSTRAP_EMAILS` allow-list and
 * they aren't in `platform_admins` yet, they're granted access and the
 * row is created on the spot. This lets a fresh deploy get its first
 * platform admin without a manual SQL insert — every admin after that
 * is added from Settings → Platform admins (which itself requires
 * already being one).
 */
export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new UnauthorizedError();

  const { data, error: lookupErr } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (lookupErr) {
    console.error("[requirePlatformAdmin] lookup error:", lookupErr);
    throw new ForbiddenError("Could not verify platform admin access");
  }

  if (data) return { supabase, userId: user.id, email: user.email ?? null };

  if (isBootstrapEmail(user.email, process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAILS)) {
    const { error: insertErr } = await platformAdminClient()
      .from("platform_admins")
      .insert({ user_id: user.id });
    if (!insertErr) {
      return { supabase, userId: user.id, email: user.email ?? null };
    }
    console.error("[requirePlatformAdmin] bootstrap insert failed:", insertErr);
  }

  throw new ForbiddenError("Platform admin access required");
}

/**
 * Non-throwing status check — used by lightweight "does this user get
 * a Super Admin link at all" probes (e.g. the sidebar), where a 401/403
 * would be the wrong shape for the caller to handle.
 */
export async function isCurrentUserPlatformAdmin(): Promise<boolean> {
  try {
    await requirePlatformAdmin();
    return true;
  } catch {
    return false;
  }
}
