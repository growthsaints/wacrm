// ============================================================
// /api/account/members/[userId]/feature-grants
//
//   GET — the target member's currently granted gated features
//         (broadcasts/automations/templates). Admin+.
//   PUT — replace the target member's full grant set with the
//         provided list. Admin+.
//
// RLS on agent_feature_grants (migration 043) already restricts
// insert/delete to admin+ of the same account, and select to admin+
// or the row's own user — this route just gives the Members UI a
// convenient "read current state, write full new state" shape
// instead of one row at a time.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import type { GatedFeature } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const GATED_FEATURES: readonly GatedFeature[] = [
  "broadcasts",
  "automations",
  "templates",
];

function isGatedFeature(value: unknown): value is GatedFeature {
  return (
    typeof value === "string" &&
    (GATED_FEATURES as readonly string[]).includes(value)
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { userId } = await params;

    const { data, error } = await ctx.supabase
      .from("agent_feature_grants")
      .select("feature")
      .eq("account_id", ctx.accountId)
      .eq("user_id", userId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      features: (data ?? []).map((row) => row.feature as GatedFeature),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:featureGrants:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { features?: unknown }
      | null;
    const features = body?.features;
    if (!Array.isArray(features) || !features.every(isGatedFeature)) {
      return NextResponse.json(
        {
          error: `'features' must be an array from: ${GATED_FEATURES.join(", ")}`,
        },
        { status: 400 },
      );
    }

    // Replace-the-full-set: simplest correct approach for a
    // low-frequency admin action — delete everything for this member,
    // then insert exactly what was requested (if anything).
    const { error: deleteErr } = await ctx.supabase
      .from("agent_feature_grants")
      .delete()
      .eq("account_id", ctx.accountId)
      .eq("user_id", userId);
    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    if (features.length > 0) {
      const { error: insertErr } = await ctx.supabase
        .from("agent_feature_grants")
        .insert(
          features.map((feature) => ({
            account_id: ctx.accountId,
            user_id: userId,
            feature,
            granted_by: ctx.userId,
          })),
        );
      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, features });
  } catch (err) {
    return toErrorResponse(err);
  }
}
