// ============================================================
// POST /api/platform/organizations/[id]/impersonate
//
// "Login as Client" — starts a support impersonation session as the
// organization's owner.
//
// Mechanics: we mint a Supabase Admin API magic-link token for the
// owner's email (this does NOT send an email — generateLink() only
// creates the token; sending only happens via signInWithOtp, which we
// never call) and immediately redeem it server-side with verifyOtp().
// The request-bound Supabase client's cookie adapter then writes the
// resulting session straight onto this response, swapping the
// browser into the target user's session. The platform admin's own
// session tokens are stashed in an encrypted cookie (see
// src/lib/platform/impersonation.ts) so "Return to admin" can restore
// them without a second login. Every start/stop is audited in
// `impersonation_log`.
// ============================================================

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { toErrorResponse, UnauthorizedError } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { platformAdminClient } from "@/lib/platform/admin-client";
import { createClient } from "@/lib/supabase/server";
import {
  encodeImpersonationCookie,
  impersonationCookieOptions,
  IMPERSONATION_COOKIE,
} from "@/lib/platform/impersonation";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin();

    const limit = checkRateLimit(
      `platform:impersonate:${ctx.userId}`,
      RATE_LIMITS.platformAdminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id: accountId } = await params;

    const {
      data: { session: adminSession },
    } = await ctx.supabase.auth.getSession();
    if (!adminSession) throw new UnauthorizedError();

    const { data: account, error: acctErr } = await ctx.supabase
      .from("accounts")
      .select("id, name, status")
      .eq("id", accountId)
      .maybeSingle();
    if (acctErr) {
      console.error("[impersonate] account lookup error:", acctErr);
      return NextResponse.json(
        { error: "Failed to load organization" },
        { status: 500 },
      );
    }
    if (!account) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: ownerProfile, error: ownerErr } = await ctx.supabase
      .from("profiles")
      .select("user_id, email")
      .eq("account_id", accountId)
      .eq("account_role", "owner")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (ownerErr) {
      console.error("[impersonate] owner lookup error:", ownerErr);
      return NextResponse.json(
        { error: "Failed to load organization owner" },
        { status: 500 },
      );
    }
    if (!ownerProfile?.email) {
      return NextResponse.json(
        { error: "This organization has no owner to sign in as" },
        { status: 409 },
      );
    }

    const admin = platformAdminClient();

    const { data: logRow, error: logErr } = await admin
      .from("impersonation_log")
      .insert({
        platform_admin_user_id: ctx.userId,
        target_account_id: accountId,
        target_user_id: ownerProfile.user_id,
      })
      .select("id")
      .single();
    if (logErr || !logRow) {
      console.error("[impersonate] audit log insert failed:", logErr);
      return NextResponse.json(
        { error: "Failed to start impersonation" },
        { status: 500 },
      );
    }

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: ownerProfile.email,
    });
    if (linkErr || !linkData) {
      console.error("[impersonate] generateLink failed:", linkErr);
      return NextResponse.json(
        { error: "Failed to start impersonation" },
        { status: 500 },
      );
    }

    const requestClient = await createClient();
    const { data: verifyData, error: verifyErr } = await requestClient.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: "magiclink",
    });
    if (verifyErr || !verifyData.session) {
      console.error("[impersonate] verifyOtp failed:", verifyErr);
      return NextResponse.json(
        { error: "Failed to start impersonation" },
        { status: 500 },
      );
    }

    const cookieStore = await cookies();
    cookieStore.set(
      IMPERSONATION_COOKIE,
      encodeImpersonationCookie({
        logId: logRow.id,
        accountId,
        accountName: account.name,
        adminAccessToken: adminSession.access_token,
        adminRefreshToken: adminSession.refresh_token,
      }),
      impersonationCookieOptions(),
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
