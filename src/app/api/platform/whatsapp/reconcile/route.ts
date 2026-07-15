// ============================================================
// GET /api/platform/whatsapp/reconcile
//
// On-demand cross-check between our `whatsapp_config` rows and what
// Meta's Graph API says this deployment's Business Manager currently
// owns/has shared with it (via the Tech Provider System User token).
// Our DB can drift from Meta's records — a row edited/deleted
// directly in Supabase, or a client revoking access on Meta's side —
// and nothing else in the app would ever surface that. This is a
// manual check, not a background job: Super Admin clicks it when they
// want to verify, it isn't wired into any automatic flow.
//
// Inactive (returns `configured: false`) until both META_BUSINESS_ID
// and META_SYSTEM_USER_TOKEN are set — see .env.local.example.
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { fetchBusinessWabaAccounts } from "@/lib/whatsapp/meta-api";

export async function GET() {
  try {
    const { supabase } = await requirePlatformAdmin();

    const businessId = process.env.META_BUSINESS_ID;
    const systemUserToken = process.env.META_SYSTEM_USER_TOKEN;
    if (!businessId || !systemUserToken) {
      return NextResponse.json({ configured: false });
    }

    const { data: configs, error } = await supabase
      .from("whatsapp_config")
      .select("account_id, waba_id, business_name, display_phone_number")
      .not("waba_id", "is", null);

    if (error) {
      console.error("[GET /api/platform/whatsapp/reconcile] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load local WhatsApp configs" },
        { status: 500 },
      );
    }

    const accountIds = (configs ?? []).map((c) => c.account_id);
    const { data: accounts } = accountIds.length
      ? await supabase.from("accounts").select("id, name").in("id", accountIds)
      : { data: [] as { id: string; name: string }[] };
    const accountNameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));

    const { owned, client } = await fetchBusinessWabaAccounts({
      businessId,
      systemUserToken,
    });
    const metaWabas = [...owned, ...client];
    const metaWabaIds = new Set(metaWabas.map((w) => w.id));
    const dbWabaIds = new Set((configs ?? []).map((c) => c.waba_id as string));

    // In our DB, but Meta no longer lists it under this business —
    // access was likely revoked or the WABA was disconnected on Meta's
    // side without our webhook catching it.
    const missingFromMeta = (configs ?? [])
      .filter((c) => c.waba_id && !metaWabaIds.has(c.waba_id))
      .map((c) => ({
        accountId: c.account_id,
        organizationName: accountNameById.get(c.account_id) ?? "Unknown organization",
        wabaId: c.waba_id as string,
        businessName: c.business_name,
        displayPhoneNumber: c.display_phone_number,
      }));

    // Meta shows access to it, but we have no matching row — either a
    // signup that never finished writing to our DB, or a manual DB
    // edit/deletion.
    const missingFromDb = metaWabas
      .filter((w) => !dbWabaIds.has(w.id))
      .map((w) => ({ wabaId: w.id, name: w.name ?? null }));

    return NextResponse.json({
      configured: true,
      metaTotal: metaWabaIds.size,
      dbTotal: dbWabaIds.size,
      missingFromMeta,
      missingFromDb,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
