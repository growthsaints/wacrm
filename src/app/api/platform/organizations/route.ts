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

const PAGE_SIZE = 25;

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
