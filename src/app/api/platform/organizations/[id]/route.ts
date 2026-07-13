// ============================================================
// /api/platform/organizations/[id]
//
//   GET   — organization detail: profile, members, WhatsApp status,
//           and usage counts (Client management + Usage dashboard).
//   PATCH — suspend / reinstate the tenant (Client management).
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { startOfMonthIso } from "@/lib/platform/usage";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase } = await requirePlatformAdmin();
    const { id } = await params;

    const { data: account, error: acctErr } = await supabase
      .from("accounts")
      .select("id, name, status, created_at, default_currency")
      .eq("id", id)
      .maybeSingle();

    if (acctErr) {
      console.error("[GET /api/platform/organizations/[id]] account error:", acctErr);
      return NextResponse.json(
        { error: "Failed to load organization" },
        { status: 500 },
      );
    }
    if (!account) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [
      membersRes,
      whatsappRes,
      contactsCount,
      conversationsCount,
      messagesCount,
      messagesThisMonthCount,
      broadcastsCount,
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("user_id, full_name, email, avatar_url, account_role, created_at")
        .eq("account_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("whatsapp_config")
        .select("phone_number_id, status, connected_at")
        .eq("account_id", id)
        .maybeSingle(),
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("account_id", id),
      supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("account_id", id),
      // messages has no account_id of its own — filter through the
      // owning conversation via an inner-join embed, the documented
      // PostgREST pattern for "count rows matching a related table".
      supabase
        .from("messages")
        .select("id, conversations!inner(account_id)", {
          count: "exact",
          head: true,
        })
        .eq("conversations.account_id", id),
      supabase
        .from("messages")
        .select("id, conversations!inner(account_id)", {
          count: "exact",
          head: true,
        })
        .eq("conversations.account_id", id)
        .gte("created_at", startOfMonthIso()),
      supabase
        .from("broadcasts")
        .select("id", { count: "exact", head: true })
        .eq("account_id", id),
    ]);

    return NextResponse.json({
      organization: {
        id: account.id,
        name: account.name,
        status: account.status,
        createdAt: account.created_at,
        defaultCurrency: account.default_currency,
      },
      members: membersRes.data ?? [],
      whatsapp: whatsappRes.data
        ? {
            configured: true,
            connected: whatsappRes.data.status === "connected",
            connectedAt: whatsappRes.data.connected_at,
          }
        : { configured: false, connected: false, connectedAt: null },
      usage: {
        members: (membersRes.data ?? []).length,
        contacts: contactsCount.count ?? 0,
        conversations: conversationsCount.count ?? 0,
        messages: {
          total: messagesCount.count ?? 0,
          thisMonth: messagesThisMonthCount.count ?? 0,
        },
        broadcasts: broadcastsCount.count ?? 0,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin();

    const limit = checkRateLimit(
      `platform:orgStatus:${ctx.userId}`,
      RATE_LIMITS.platformAdminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as
      | { status?: unknown }
      | null;
    const status = body?.status;

    if (status !== "active" && status !== "suspended") {
      return NextResponse.json(
        { error: "'status' must be 'active' or 'suspended'" },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase
      .from("accounts")
      .update({ status })
      .eq("id", id)
      .select("id, name, status")
      .maybeSingle();

    if (error) {
      console.error("[PATCH /api/platform/organizations/[id]] update error:", error);
      return NextResponse.json(
        { error: "Failed to update organization" },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ organization: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
