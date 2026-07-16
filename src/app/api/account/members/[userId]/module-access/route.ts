// ============================================================
// /api/account/members/[userId]/module-access
//
//   GET — the target admin's currently granted modules
//         (enterprise / business_workspace). Owner-only.
//   PUT — replace the target admin's full grant set. Owner-only.
//
// Owner-only (not admin+) because this governs OTHER admins' access —
// an admin granting themselves or a peer admin elevated module access
// would defeat the point of gating admins by default. RLS on
// module_access_grants (migration 053) enforces the same restriction
// independently of this route.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

type GatedModule = "enterprise" | "business_workspace";
const GATED_MODULES: readonly GatedModule[] = ["enterprise", "business_workspace"];

function isGatedModule(value: unknown): value is GatedModule {
  return typeof value === "string" && (GATED_MODULES as readonly string[]).includes(value);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("owner");
    const { userId } = await params;

    const { data, error } = await ctx.supabase
      .from("module_access_grants")
      .select("module")
      .eq("account_id", ctx.accountId)
      .eq("user_id", userId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      modules: (data ?? []).map((row) => row.module as GatedModule),
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
    const ctx = await requireRole("owner");

    const limit = checkRateLimit(
      `owner:moduleAccess:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { modules?: unknown }
      | null;
    const modules = body?.modules;
    if (!Array.isArray(modules) || !modules.every(isGatedModule)) {
      return NextResponse.json(
        { error: `'modules' must be an array from: ${GATED_MODULES.join(", ")}` },
        { status: 400 },
      );
    }

    const { error: deleteErr } = await ctx.supabase
      .from("module_access_grants")
      .delete()
      .eq("account_id", ctx.accountId)
      .eq("user_id", userId);
    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    if (modules.length > 0) {
      const { error: insertErr } = await ctx.supabase.from("module_access_grants").insert(
        modules.map((module) => ({
          account_id: ctx.accountId,
          user_id: userId,
          module,
          granted_by: ctx.userId,
        })),
      );
      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, modules });
  } catch (err) {
    return toErrorResponse(err);
  }
}
