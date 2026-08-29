// ============================================================
// /api/account/members/[userId]/meta-ads-access
//
//   GET — whether the target member currently has Meta Ads access.
//         Owner-only.
//   PUT — grant or revoke it. Owner-only.
//
// Owner-only (not admin+) because Meta Ads is owner-gated by default
// for EVERY other role too, including admin (see requireMetaAdsAccess,
// migration 091) — unlike module_access_grants, which only ever
// restricts admins. An admin granting themselves access here would
// defeat the point. RLS on meta_ads_access_grants enforces the same
// restriction independently of this route.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("owner");
    const { userId } = await params;

    const { data, error } = await ctx.supabase
      .from("meta_ads_access_grants")
      .select("id")
      .eq("account_id", ctx.accountId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ granted: Boolean(data) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("owner");

    const limit = checkRateLimit(
      `owner:metaAdsAccess:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { granted?: unknown }
      | null;
    if (typeof body?.granted !== "boolean") {
      return NextResponse.json(
        { error: "'granted' must be a boolean" },
        { status: 400 },
      );
    }

    if (body.granted) {
      const { error: upsertErr } = await ctx.supabase
        .from("meta_ads_access_grants")
        .upsert(
          { account_id: ctx.accountId, user_id: userId, granted_by: ctx.userId },
          { onConflict: "account_id,user_id" },
        );
      if (upsertErr) {
        return NextResponse.json({ error: upsertErr.message }, { status: 500 });
      }
    } else {
      const { error: deleteErr } = await ctx.supabase
        .from("meta_ads_access_grants")
        .delete()
        .eq("account_id", ctx.accountId)
        .eq("user_id", userId);
      if (deleteErr) {
        return NextResponse.json({ error: deleteErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, granted: body.granted });
  } catch (err) {
    return toErrorResponse(err);
  }
}
