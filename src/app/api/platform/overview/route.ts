// ============================================================
// GET /api/platform/overview
//
// Platform-wide usage totals + the most recently created tenants, for
// the Super Admin dashboard home. Reads go through the RLS-scoped
// client — the `_platform_select` policies from migration 037 grant
// a platform admin visibility across every tenant's rows, so no
// service-role client is needed here.
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { startOfMonthIso } from "@/lib/platform/usage";

export async function GET() {
  try {
    const { supabase } = await requirePlatformAdmin();

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
      supabase.from("contacts").select("id", { count: "exact", head: true }),
      supabase.from("conversations").select("id", { count: "exact", head: true }),
      supabase.from("messages").select("id", { count: "exact", head: true }),
      supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startOfMonthIso()),
      supabase.from("broadcasts").select("id", { count: "exact", head: true }),
      supabase
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
