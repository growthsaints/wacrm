// ============================================================
// POST /api/account/members/create
//
// Admin+ can create a full team-member account directly — name,
// phone, email, and a password of their own choosing — rather than
// only being able to generate a self-serve invite link. The admin
// shares the resulting credentials with the teammate themselves
// (WhatsApp/Slack/whatever); the member can log in immediately with
// no signup step of their own.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { accountAdminClient } from "@/lib/auth/admin-client";
import { isAccountRole } from "@/lib/auth/roles";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const MAX_NAME_LEN = 120;
const MIN_PASSWORD_LEN = 6;

interface PostBody {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  password?: unknown;
  role?: unknown;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    // Same cap as invite creation — this is a clicks-only admin UI.
    const limit = checkRateLimit(
      `admin:memberCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as PostBody | null;

    const role = body?.role;
    if (!isAccountRole(role) || role === "owner") {
      return NextResponse.json(
        { error: "'role' must be one of admin, agent, viewer" },
        { status: 400 },
      );
    }

    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Name is required and must be ${MAX_NAME_LEN} characters or fewer` },
        { status: 400 },
      );
    }

    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    }

    const password = typeof body?.password === "string" ? body.password : "";
    if (password.length < MIN_PASSWORD_LEN) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LEN} characters` },
        { status: 400 },
      );
    }

    const phone = typeof body?.phone === "string" && body.phone.trim() ? body.phone.trim() : null;

    const admin = accountAdminClient();

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (createErr || !created.user) {
      return NextResponse.json(
        { error: createErr?.message ?? "Failed to create the member's login" },
        { status: 400 },
      );
    }

    const { error: assignErr } = await admin.rpc("assign_team_member", {
      p_user_id: created.user.id,
      p_account_id: ctx.accountId,
      p_role: role,
      p_phone: phone,
    });
    if (assignErr) {
      // Don't leave a half-created login behind — best-effort cleanup,
      // failure here is logged rather than surfaced (the create error
      // below is the one the admin needs to act on).
      await admin.auth.admin.deleteUser(created.user.id).catch((err) => {
        console.error("[POST /api/account/members/create] cleanup deleteUser failed:", err);
      });
      console.error("[POST /api/account/members/create] assign_team_member failed:", assignErr.message);
      return NextResponse.json({ error: "Failed to add the member to this account" }, { status: 500 });
    }

    return NextResponse.json(
      {
        member: { user_id: created.user.id, name, phone, email, role },
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
