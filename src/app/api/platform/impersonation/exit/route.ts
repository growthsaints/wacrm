// ============================================================
// POST /api/platform/impersonation/exit
//
// "Return to admin" — restores the platform admin's own session from
// the encrypted cookie stashed at the start of impersonation, and
// closes out the audit trail row. Deliberately does NOT require
// requirePlatformAdmin() — by the time this is called the browser's
// active session IS the impersonated tenant user, not the admin, so
// the only proof-of-authority is the encrypted cookie itself.
// ============================================================

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { platformAdminClient } from "@/lib/platform/admin-client";
import {
  decodeImpersonationCookie,
  IMPERSONATION_COOKIE,
} from "@/lib/platform/impersonation";

export async function POST() {
  const cookieStore = await cookies();
  const payload = decodeImpersonationCookie(
    cookieStore.get(IMPERSONATION_COOKIE)?.value,
  );

  if (!payload) {
    cookieStore.delete(IMPERSONATION_COOKIE);
    return NextResponse.json(
      { error: "Not currently impersonating" },
      { status: 400 },
    );
  }

  const requestClient = await createClient();
  const { error } = await requestClient.auth.setSession({
    access_token: payload.adminAccessToken,
    refresh_token: payload.adminRefreshToken,
  });

  const admin = platformAdminClient();
  await admin
    .from("impersonation_log")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", payload.logId)
    .is("ended_at", null);

  cookieStore.delete(IMPERSONATION_COOKIE);

  if (error) {
    // The admin's stashed refresh token may have expired across a long
    // impersonation session — fail safe into a clean re-login rather
    // than leaving the browser in a half-restored state.
    console.error("[impersonation exit] restoring admin session failed:", error);
    return NextResponse.json({ ok: true, redirect: "/login" });
  }

  return NextResponse.json({ ok: true, redirect: "/platform/organizations" });
}
