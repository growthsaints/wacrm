// ============================================================
// GET /api/platform/whatsapp
//
// Every connected WhatsApp number across every organization, for the
// Super Admin "WhatsApp Numbers" page: connection health, token
// status, sync status, last activity, and which organization owns
// it. `whatsapp_config` reads go through the service-role client (see
// migration 056 — the old `whatsapp_config_platform_select` RLS
// policy applied to *every* query a platform admin made, including
// their own regular Settings → WhatsApp page). `accounts` still reads
// through the RLS-scoped client via `accounts_platform_select`.
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { platformAdminClient } from "@/lib/platform/admin-client";
import { computeHealthStatus } from "@/lib/whatsapp/embedded-signup";

export async function GET() {
  try {
    const { supabase } = await requirePlatformAdmin();
    const admin = platformAdminClient();

    const { data: configs, error } = await admin
      .from("whatsapp_config")
      .select(
        "account_id, phone_number_id, display_phone_number, business_name, display_name, status, quality_rating, messaging_limit_tier, code_verification_status, onboarding_method, registered_at, last_registration_error, last_synced_at, connected_at, created_at",
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[GET /api/platform/whatsapp] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load WhatsApp numbers" },
        { status: 500 },
      );
    }

    const accountIds = (configs ?? []).map((c) => c.account_id);
    const { data: accounts } = accountIds.length
      ? await supabase.from("accounts").select("id, name").in("id", accountIds)
      : { data: [] as { id: string; name: string }[] };
    const accountNameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));

    const numbers = (configs ?? []).map((c) => ({
      accountId: c.account_id,
      organizationName: accountNameById.get(c.account_id) ?? "Unknown organization",
      businessName: c.business_name,
      displayName: c.display_name,
      displayPhoneNumber: c.display_phone_number,
      status: c.status as "connected" | "disconnected",
      qualityRating: c.quality_rating,
      messagingLimitTier: c.messaging_limit_tier,
      codeVerificationStatus: c.code_verification_status,
      onboardingMethod: c.onboarding_method as "manual" | "embedded_signup",
      lastSyncedAt: c.last_synced_at,
      connectedAt: c.connected_at,
      createdAt: c.created_at,
      health: computeHealthStatus({
        hasConfig: true,
        registeredAt: c.registered_at,
        qualityRating: c.quality_rating,
        lastRegistrationError: c.last_registration_error,
      }),
    }));

    return NextResponse.json({ numbers });
  } catch (err) {
    return toErrorResponse(err);
  }
}
