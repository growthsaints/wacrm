// ============================================================
// GET /api/platform/organizations/needs-attention
//
// Managed-plan accounts with an unresolved, keyword-flagged
// account-level webhook event (see logAccountLevelEvent in
// /api/whatsapp/webhook) — the Super Admin queue for "this client's
// WABA might be banned/restricted and needs re-provisioning."
// ============================================================

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform";

export async function GET() {
  try {
    const { supabase } = await requirePlatformAdmin();

    const { data: events, error } = await supabase
      .from("whatsapp_account_events")
      .select("id, account_id, field, raw_value, created_at")
      .eq("flagged", true)
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const accountIds = [...new Set((events ?? []).map((e) => e.account_id).filter(Boolean))] as string[];
    if (accountIds.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const { data: accounts, error: acctErr } = await supabase
      .from("accounts")
      .select("id, name, plan_type, managed_renewals_used, managed_renewals_max, plan_expires_at")
      .in("id", accountIds)
      .eq("plan_type", "managed");
    if (acctErr) {
      return NextResponse.json({ error: acctErr.message }, { status: 500 });
    }

    const accountById = new Map((accounts ?? []).map((a) => [a.id, a]));
    const items = (events ?? [])
      .filter((e) => e.account_id && accountById.has(e.account_id))
      .map((e) => ({
        eventId: e.id,
        field: e.field,
        rawValue: e.raw_value,
        createdAt: e.created_at,
        account: accountById.get(e.account_id as string),
      }));

    return NextResponse.json({ items });
  } catch (err) {
    return toErrorResponse(err);
  }
}
