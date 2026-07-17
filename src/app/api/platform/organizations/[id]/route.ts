// ============================================================
// /api/platform/organizations/[id]
//
//   GET    — organization detail: profile, members, WhatsApp status,
//           and usage counts (Client management + Usage dashboard).
//   PATCH  — suspend / reinstate the tenant (Client management).
//   DELETE — permanently delete the tenant and every member's login.
//           Irreversible — see the DELETE handler below.
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { platformAdminClient } from "@/lib/platform/admin-client";
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

    // contacts/conversations/messages/broadcasts/whatsapp_config lost
    // their blanket is_platform_admin() SELECT policy in migration 056
    // (it was the cross-account data leak) — reading another tenant's
    // rows here now needs the service-role client, same as
    // /api/platform/overview and /api/platform/whatsapp already do.
    // accounts/profiles keep their own platform_select policies, so
    // those two stay on the regular RLS-scoped client.
    const admin = platformAdminClient();

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
      admin
        .from("whatsapp_config")
        .select("phone_number_id, status, connected_at")
        .eq("account_id", id)
        .maybeSingle(),
      admin
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("account_id", id),
      admin
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("account_id", id),
      // messages has no account_id of its own — filter through the
      // owning conversation via an inner-join embed, the documented
      // PostgREST pattern for "count rows matching a related table".
      admin
        .from("messages")
        .select("id, conversations!inner(account_id)", {
          count: "exact",
          head: true,
        })
        .eq("conversations.account_id", id),
      admin
        .from("messages")
        .select("id, conversations!inner(account_id)", {
          count: "exact",
          head: true,
        })
        .eq("conversations.account_id", id)
        .gte("created_at", startOfMonthIso()),
      admin
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

/**
 * DELETE /api/platform/organizations/[id] — permanently deletes a
 * tenant. Irreversible, so the client requires the caller to type the
 * exact organization name before this is ever called; this handler
 * re-checks that name server-side too (`confirmName` in the body) as
 * defense against a stray/duplicated request.
 *
 * Order of operations:
 *   1. Look up every member's user_id (service-role — the same
 *      cross-tenant-read reasoning as the GET handler above).
 *   2. Delete the `accounts` row. Every domain table cascades off
 *      `account_id REFERENCES accounts(id) ON DELETE CASCADE`
 *      (contacts, conversations, messages via conversations,
 *      broadcasts, automations, flows, templates, wallet_transactions,
 *      invoices, licenses, …), including `profiles` itself.
 *   3. Delete each member's `auth.users` row via the Admin API. A
 *      profile row is gone the moment step 2 cascades, and nothing
 *      re-creates one on next login (handle_new_user only fires on
 *      INSERT) — so leaving the login behind would just orphan it
 *      into a permanently broken account. Best-effort: a failure here
 *      is logged but doesn't undo the already-completed data deletion.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin();

    const limit = checkRateLimit(
      `platform:orgDelete:${ctx.userId}`,
      RATE_LIMITS.platformAdminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as
      | { confirmName?: unknown }
      | null;

    const admin = platformAdminClient();

    const { data: account, error: acctErr } = await admin
      .from("accounts")
      .select("id, name")
      .eq("id", id)
      .maybeSingle();
    if (acctErr) {
      console.error("[DELETE /api/platform/organizations/[id]] account lookup error:", acctErr);
      return NextResponse.json({ error: "Failed to load organization" }, { status: 500 });
    }
    if (!account) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (typeof body?.confirmName !== "string" || body.confirmName !== account.name) {
      return NextResponse.json(
        { error: "Organization name confirmation does not match" },
        { status: 400 },
      );
    }

    const { data: members, error: membersErr } = await admin
      .from("profiles")
      .select("user_id")
      .eq("account_id", id);
    if (membersErr) {
      console.error("[DELETE /api/platform/organizations/[id]] members lookup error:", membersErr);
      return NextResponse.json({ error: "Failed to load organization members" }, { status: 500 });
    }

    const { error: deleteErr } = await admin.from("accounts").delete().eq("id", id);
    if (deleteErr) {
      console.error("[DELETE /api/platform/organizations/[id]] account delete error:", deleteErr);
      return NextResponse.json({ error: "Failed to delete organization" }, { status: 500 });
    }

    for (const member of members ?? []) {
      const { error: authDeleteErr } = await admin.auth.admin.deleteUser(member.user_id);
      if (authDeleteErr) {
        console.error(
          `[DELETE /api/platform/organizations/[id]] auth user delete failed for ${member.user_id}:`,
          authDeleteErr.message,
        );
      }
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
