// ============================================================
// GET /api/platform/overview
//
// Platform-wide usage totals + the most recently created tenants, for
// the Super Admin dashboard home. `accounts` reads go through the
// RLS-scoped client (the `accounts_platform_select` policy grants a
// platform admin visibility there). Everything else — contacts,
// conversations, messages, broadcasts, whatsapp_config — goes through
// the service-role client instead of relying on an equivalent
// `_platform_select` policy: those tables hold tenant PII/business
// data, and an RLS policy that grants a platform admin blanket SELECT
// there applies to *every* query they make anywhere in the app, not
// just this dashboard — including their own regular /contacts,
// /inbox, /broadcasts pages, which query these same tables without an
// explicit account_id filter and so silently returned every tenant's
// rows. See migration 056, which drops those five policies now that
// nothing needs them.
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { platformAdminClient } from "@/lib/platform/admin-client";
import { startOfMonthIso } from "@/lib/platform/usage";

export async function GET() {
  try {
    const { supabase } = await requirePlatformAdmin();
    const admin = platformAdminClient();

    const [
      accountsTotal,
      accountsActive,
      accountsSuspended,
      contactsTotal,
      conversationsTotal,
      messagesTotal,
      messagesThisMonth,
      broadcastsTotal,
      whatsappConnected,
      recentAccounts,
    ] = await Promise.all([
      supabase.from("accounts").select("id", { count: "exact", head: true }),
      supabase
        .from("accounts")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      supabase
        .from("accounts")
        .select("id", { count: "exact", head: true })
        .eq("status", "suspended"),
      admin.from("contacts").select("id", { count: "exact", head: true }),
      admin.from("conversations").select("id", { count: "exact", head: true }),
      admin.from("messages").select("id", { count: "exact", head: true }),
      admin
        .from("messages")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startOfMonthIso()),
      admin.from("broadcasts").select("id", { count: "exact", head: true }),
      admin
        .from("whatsapp_config")
        .select("id", { count: "exact", head: true })
        .eq("status", "connected"),
      supabase
        .from("accounts")
        .select("id, name, status, created_at")
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

    return NextResponse.json({
      accounts: {
        total: accountsTotal.count ?? 0,
        active: accountsActive.count ?? 0,
        suspended: accountsSuspended.count ?? 0,
      },
      contacts: contactsTotal.count ?? 0,
      conversations: conversationsTotal.count ?? 0,
      messages: {
        total: messagesTotal.count ?? 0,
        thisMonth: messagesThisMonth.count ?? 0,
      },
      broadcasts: broadcastsTotal.count ?? 0,
      whatsappConnected: whatsappConnected.count ?? 0,
      recentOrganizations: recentAccounts.data ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
