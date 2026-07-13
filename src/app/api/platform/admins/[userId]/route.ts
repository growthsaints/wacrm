// ============================================================
// DELETE /api/platform/admins/[userId]
//
// Revokes platform-admin access. Blocks removing the last remaining
// admin — without this a mis-click could lock every operator out of
// the Super Admin dashboard with no way back in short of a direct DB
// edit.
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { platformAdminClient } from "@/lib/platform/admin-client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin();

    const limit = checkRateLimit(
      `platform:adminRemove:${ctx.userId}`,
      RATE_LIMITS.platformAdminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;
    const admin = platformAdminClient();

    const { count, error: countErr } = await admin
      .from("platform_admins")
      .select("id", { count: "exact", head: true });
    if (countErr) {
      console.error("[DELETE /api/platform/admins/[userId]] count error:", countErr);
      return NextResponse.json(
        { error: "Failed to remove platform admin" },
        { status: 500 },
      );
    }
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Cannot remove the last remaining platform admin" },
        { status: 409 },
      );
    }

    const { error } = await admin
      .from("platform_admins")
      .delete()
      .eq("user_id", userId);
    if (error) {
      console.error("[DELETE /api/platform/admins/[userId]] delete error:", error);
      return NextResponse.json(
        { error: "Failed to remove platform admin" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
