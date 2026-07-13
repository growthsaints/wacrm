// ============================================================
// GET /api/platform/whoami
//
// Lightweight, non-throwing status probe: is the caller a platform
// admin? Used by the tenant sidebar to decide whether to show the
// "Super Admin" link — a 401/403 would be the wrong shape for that
// caller, it just wants a boolean either way.
// ============================================================

import { NextResponse } from "next/server";
import { isCurrentUserPlatformAdmin } from "@/lib/auth/platform";

export async function GET() {
  const isPlatformAdmin = await isCurrentUserPlatformAdmin();
  return NextResponse.json({ isPlatformAdmin });
}
