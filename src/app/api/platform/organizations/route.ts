// ============================================================
// GET /api/platform/organizations
//
// Lists every tenant account for the Super Admin "Organizations" page
// and the workspace switcher: searchable by name, paginated, with a
// per-org member count and WhatsApp connection status batched in
// (not N+1'd per row).
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { platformAdminClient } from "@/lib/platform/admin-client";
import { createRazorpaySubscription } from "@/lib/billing/razorpay-client";

const PAGE_SIZE = 25;
const MANAGED_PLAN_TERM_MONTHS = 3;
const MANAGED_PLAN_RENEWALS_MAX = 4;

export async function GET(request: Request) {
  try {
    const { supabase } = await requirePlatformAdmin();
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() ?? "";
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("accounts")
      .select("id, name, status, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (q) query = query.ilike("name", `%${q}%`);

    const { data, error, count } = await query;
    if (error) {
      console.error("[GET /api/platform/organizations] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load organizations" },
        { status: 500 },
      );
    }

    const ids = (data ?? []).map((a) => a.id);
    const [membersRes, whatsappRes] = await Promise.all([
      ids.length
        ? supabase.from("profiles").select("account_id").in("account_id", ids)
        : Promise.resolve({ data: [] as { account_id: string }[] }),
      ids.length
        ? supabase
            .from("whatsapp_config")
            .select("account_id, status")
            .in("account_id", ids)
        : Promise.resolve({ data: [] as { account_id: string; status: string }[] }),
    ]);

    const memberCounts = new Map<string, number>();
    for (const row of membersRes.data ?? []) {
      memberCounts.set(row.account_id, (memberCounts.get(row.account_id) ?? 0) + 1);
    }
    const whatsappStatus = new Map<string, string>();
    for (const row of whatsappRes.data ?? []) {
      whatsappStatus.set(row.account_id, row.status);
    }

    const organizations = (data ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status as "active" | "suspended",
      createdAt: a.created_at,
      memberCount: memberCounts.get(a.id) ?? 0,
      whatsappStatus: whatsappStatus.get(a.id) ?? "disconnected",
    }));

    return NextResponse.json({
      organizations,
      page,
      pageSize: PAGE_SIZE,
      total: count ?? organizations.length,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

interface CreateManagedOrgBody {
  email?: string;
  password?: string;
  businessName?: string;
}

/**
 * POST /api/platform/organizations — creates a "Managed" plan account
 * directly (Super Admin provisions credentials on the client's
 * behalf). Reuses the same on_auth_user_created trigger that public
 * signup relies on (migration 017) to bootstrap the profile/account
 * row, sets the account up as a managed plan with a 3-month term and
 * a 4-renewal allowance, and creates a single-cycle (total_count: 1 —
 * charges once, does not auto-renew) Razorpay subscription against
 * the Managed plan for the ₹4500 fee. The response includes the
 * subscription's hosted `paymentUrl` for Super Admin to send the
 * client directly — plan_status stays 'inactive' until the webhook
 * reports the payment as captured.
 */
export async function POST(request: Request) {
  try {
    await requirePlatformAdmin();

    const body = (await request.json().catch(() => null)) as CreateManagedOrgBody | null;
    const email = body?.email?.trim();
    const password = body?.password;
    const businessName = body?.businessName?.trim();

    if (!email || !password || password.length < 6) {
      return NextResponse.json(
        { error: "email and a password (min 6 chars) are required" },
        { status: 400 },
      );
    }

    const admin = platformAdminClient();

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: businessName ? { full_name: businessName } : undefined,
    });
    if (createErr || !created.user) {
      return NextResponse.json(
        { error: createErr?.message ?? "Failed to create user" },
        { status: 400 },
      );
    }

    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("account_id")
      .eq("user_id", created.user.id)
      .maybeSingle();
    if (profileErr || !profile?.account_id) {
      return NextResponse.json(
        { error: "User created, but account bootstrap did not complete — check logs" },
        { status: 500 },
      );
    }

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + MANAGED_PLAN_TERM_MONTHS);

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const managedPlanId = process.env.RAZORPAY_MANAGED_PLAN_ID;
    let paymentUrl: string | null = null;
    let razorpaySubscriptionId: string | null = null;

    if (keyId && keySecret && managedPlanId) {
      try {
        const subscription = await createRazorpaySubscription({
          keyId,
          keySecret,
          planId: managedPlanId,
          accountId: profile.account_id,
          totalCount: 1, // one charge only — this is a fixed 3-month term, not an auto-renewing subscription
        });
        paymentUrl = subscription.shortUrl;
        razorpaySubscriptionId = subscription.id;
      } catch (err) {
        console.error("[platform/organizations] Razorpay subscription creation failed:", err);
        // Account is already created — surface the payment-link failure
        // but don't roll back the user/account; Super Admin can retry
        // sharing a link or collect payment another way.
      }
    }

    const { data: account, error: updateErr } = await admin
      .from("accounts")
      .update({
        plan_type: "managed",
        plan_status: "inactive",
        plan_expires_at: expiresAt.toISOString(),
        managed_renewals_used: 0,
        managed_renewals_max: MANAGED_PLAN_RENEWALS_MAX,
        razorpay_subscription_id: razorpaySubscriptionId,
        razorpay_plan_id: managedPlanId ?? null,
      })
      .eq("id", profile.account_id)
      .select("id, name, plan_type, plan_status, plan_expires_at, managed_renewals_max")
      .single();
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      organization: account,
      credentials: { email, password },
      paymentUrl,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
