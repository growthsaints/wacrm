// ============================================================
// /api/platform/admins
//
//   GET  — list every platform admin (Settings → Platform admins).
//   POST — grant platform-admin access to an existing user by email.
//
// Membership has no client INSERT policy (migration 037), so writes
// go through the service-role client — gated by requirePlatformAdmin()
// on the route itself, same "TS layer forwards, RLS/service-role is
// the real gate" split used by the account member-management routes.
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { platformAdminClient } from "@/lib/platform/admin-client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function GET() {
  try {
    const { supabase } = await requirePlatformAdmin();

    const { data: admins, error } = await supabase
      .from("platform_admins")
      .select("user_id, created_at")
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[GET /api/platform/admins] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load platform admins" },
        { status: 500 },
      );
    }

    const userIds = (admins ?? []).map((a) => a.user_id);
    const { data: profiles } = userIds.length
      ? await supabase
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", userIds)
      : {
          data: [] as {
            user_id: string;
            full_name: string | null;
            email: string | null;
          }[],
        };

    const profileByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p]));

    const result = (admins ?? []).map((a) => ({
      userId: a.user_id,
      createdAt: a.created_at,
      fullName: profileByUserId.get(a.user_id)?.full_name ?? null,
      email: profileByUserId.get(a.user_id)?.email ?? null,
    }));

    return NextResponse.json({ admins: result });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePlatformAdmin();

    const limit = checkRateLimit(
      `platform:adminAdd:${ctx.userId}`,
      RATE_LIMITS.platformAdminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { email?: unknown }
      | null;
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    if (!email) {
      return NextResponse.json({ error: "'email' is required" }, { status: 400 });
    }

    const admin = platformAdminClient();

    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("user_id")
      .ilike("email", email)
      .maybeSingle();
    if (profileErr) {
      console.error("[POST /api/platform/admins] profile lookup error:", profileErr);
      return NextResponse.json(
        { error: "Failed to look up user" },
        { status: 500 },
      );
    }
    if (!profile) {
      return NextResponse.json(
        { error: "No user with that email exists yet" },
        { status: 404 },
      );
    }

    const { error: insertErr } = await admin
      .from("platform_admins")
      .insert({ user_id: profile.user_id, created_by: ctx.userId });
    if (insertErr) {
      if (insertErr.code === "23505") {
        return NextResponse.json(
          { error: "That user is already a platform admin" },
          { status: 409 },
        );
      }
      console.error("[POST /api/platform/admins] insert error:", insertErr);
      return NextResponse.json(
        { error: "Failed to add platform admin" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
