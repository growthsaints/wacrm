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
import { dailyCapForTier } from "@/lib/whatsapp/messaging-limit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase } = await requirePlatformAdmin();
    const { id } = await params;

    const { data: account, error: acctErr } = await supabase
      .from("accounts")
      .select(
        "id, name, status, created_at, default_currency, plan_type, plan_status, plan_expires_at, plan_free_granted, wallet_balance",
      )
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
      whatsappEventsRes,
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("user_id, full_name, email, avatar_url, account_role, created_at")
        .eq("account_id", id)
        .order("created_at", { ascending: true }),
      admin
        .from("whatsapp_config")
        .select("phone_number_id, status, connected_at, messaging_limit_tier")
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
      // Flagged, unresolved account-level webhook events (see
      // logAccountLevelEvent in /api/whatsapp/webhook) — surfaced here
      // for every plan type, unlike /needs-attention which only lists
      // 'managed' accounts (that endpoint is the Super Admin queue for
      // client re-provisioning specifically; this is "does THIS
      // account, whatever its plan, have something flagged").
      admin
        .from("whatsapp_account_events")
        .select("id, field, raw_value, created_at")
        .eq("account_id", id)
        .eq("flagged", true)
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    // Daily broadcast quota (see src/lib/whatsapp/daily-quota.ts, which
    // enforces the same cap at send time) — only meaningful once a
    // tier has actually synced.
    const dailyCap = dailyCapForTier(whatsappRes.data?.messaging_limit_tier ?? null);
    let usedToday: number | null = null;
    if (dailyCap !== null) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: count } = await admin.rpc("count_recent_business_initiated_contacts", {
        p_account_id: id,
        p_since: since,
      });
      usedToday = (count as number | null) ?? 0;
    }

    return NextResponse.json({
      organization: {
        id: account.id,
        name: account.name,
        status: account.status,
        createdAt: account.created_at,
        defaultCurrency: account.default_currency,
      },
      billing: {
        planType: account.plan_type,
        planStatus: account.plan_status,
        planExpiresAt: account.plan_expires_at,
        planFreeGranted: account.plan_free_granted,
        walletBalance: Number(account.wallet_balance ?? 0),
      },
      members: membersRes.data ?? [],
      whatsapp: whatsappRes.data
        ? {
            configured: true,
            connected: whatsappRes.data.status === "connected",
            connectedAt: whatsappRes.data.connected_at,
          }
        : { configured: false, connected: false, connectedAt: null },
      quota: {
        tier: whatsappRes.data?.messaging_limit_tier ?? null,
        dailyCap,
        usedToday,
      },
      whatsappAlerts: (whatsappEventsRes.data ?? []).map((e) => ({
        id: e.id,
        field: e.field,
        rawValue: e.raw_value,
        createdAt: e.created_at,
      })),
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
      | {
          status?: unknown;
          makeFree?: unknown;
          revokeFree?: unknown;
          walletBalance?: unknown;
          resolveWhatsappAlerts?: unknown;
        }
      | null;

    // Marks this account's flagged, unresolved account-level webhook
    // events (see logAccountLevelEvent in /api/whatsapp/webhook) as
    // resolved — clears the WhatsAppAccountAlertBanner the account
    // owner sees. Separate table/action from the `accounts` row update
    // below, so it's handled and returned on its own rather than
    // folded into `update`.
    if (body?.resolveWhatsappAlerts === true) {
      const { error: resolveErr } = await ctx.supabase
        .from("whatsapp_account_events")
        .update({ resolved: true })
        .eq("account_id", id)
        .eq("flagged", true)
        .eq("resolved", false);

      if (resolveErr) {
        console.error(
          "[PATCH /api/platform/organizations/[id]] resolve whatsapp alerts error:",
          resolveErr,
        );
        return NextResponse.json(
          { error: "Failed to resolve WhatsApp alerts" },
          { status: 500 },
        );
      }

      return NextResponse.json({ resolved: true });
    }

    const update: Record<string, unknown> = {};

    if (body?.status !== undefined) {
      if (body.status !== "active" && body.status !== "suspended") {
        return NextResponse.json(
          { error: "'status' must be 'active' or 'suspended'" },
          { status: 400 },
        );
      }
      update.status = body.status;
    }

    // Super Admin override — drops the account back to the default
    // no-cost plan (same state a brand-new signup starts in), clearing
    // any managed/self-serve subscription and its expiry so no billing
    // gate blocks the account going forward.
    if (body?.makeFree === true) {
      update.plan_type = "none";
      update.plan_status = "inactive";
      update.plan_expires_at = null;
      update.razorpay_subscription_id = null;
      update.razorpay_plan_id = null;
      // Distinguishes "Super Admin explicitly comped this account"
      // from "never subscribed" — both are plan_type 'none', but only
      // this one should be exempt from the trial-expiry banner (see
      // /api/billing/plan).
      update.plan_free_granted = true;
    }

    // Undoes the grant above — the account falls back to "never
    // subscribed" and becomes subject to the trial-expiry banner again
    // (immediately, if its 14-day window already passed). Doesn't
    // touch plan_type/status — this only ever clears a grant made via
    // makeFree, it isn't a substitute for suspending a paid plan.
    if (body?.revokeFree === true) {
      update.plan_free_granted = false;
    }

    if (body?.walletBalance !== undefined) {
      const balance = Number(body.walletBalance);
      if (!Number.isFinite(balance) || balance < 0) {
        return NextResponse.json(
          { error: "'walletBalance' must be a non-negative number" },
          { status: 400 },
        );
      }
      update.wallet_balance = balance;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "Nothing to update — provide 'status', 'makeFree', and/or 'walletBalance'" },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase
      .from("accounts")
      .update(update)
      .eq("id", id)
      .select(
        "id, name, status, plan_type, plan_status, plan_expires_at, plan_free_granted, wallet_balance",
      )
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

    return NextResponse.json({
      organization: data,
      billing: {
        planType: data.plan_type,
        planStatus: data.plan_status,
        planExpiresAt: data.plan_expires_at,
        planFreeGranted: data.plan_free_granted,
        walletBalance: Number(data.wallet_balance ?? 0),
      },
    });
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
