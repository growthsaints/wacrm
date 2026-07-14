// ============================================================
// POST /api/platform/organizations/[id]/renew
//
// Records that Super Admin re-provisioned a managed-plan account's
// WhatsApp connection after a ban/restriction (the technical
// reconnection itself happens via impersonation + the normal
// Embedded Signup / manual setup flow — this route just books the
// renewal against the account's 4-renewal allowance and clears any
// flagged events that prompted it).
// ============================================================

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase } = await requirePlatformAdmin();
    const { id } = await params;

    const { data: account, error: acctErr } = await supabase
      .from("accounts")
      .select("id, plan_type, managed_renewals_used, managed_renewals_max")
      .eq("id", id)
      .maybeSingle();
    if (acctErr) {
      return NextResponse.json({ error: acctErr.message }, { status: 500 });
    }
    if (!account) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (account.plan_type !== "managed") {
      return NextResponse.json(
        { error: "Renewal tracking only applies to managed-plan accounts" },
        { status: 400 },
      );
    }
    if (account.managed_renewals_used >= account.managed_renewals_max) {
      return NextResponse.json(
        { error: `Renewal allowance (${account.managed_renewals_max}) already used up` },
        { status: 400 },
      );
    }

    const { data: updated, error: updateErr } = await supabase
      .from("accounts")
      .update({ managed_renewals_used: account.managed_renewals_used + 1 })
      .eq("id", id)
      .select("id, managed_renewals_used, managed_renewals_max")
      .single();
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    await supabase
      .from("whatsapp_account_events")
      .update({ resolved: true })
      .eq("account_id", id)
      .eq("flagged", true)
      .eq("resolved", false);

    return NextResponse.json({ organization: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
