"use client";

import { useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Shown across the top of the tenant dashboard while a platform admin
 * is impersonating this account's owner ("Login as Client", see
 * src/app/api/platform/organizations/[id]/impersonate/route.ts). Every
 * render of this banner corresponds to a live row in
 * `impersonation_log` with `ended_at IS NULL`.
 */
export function ImpersonationBanner({ accountName }: { accountName: string }) {
  const [loading, setLoading] = useState(false);

  async function exit() {
    setLoading(true);
    try {
      const res = await fetch("/api/platform/impersonation/exit", { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      // Full navigation — the session cookies just changed under us.
      window.location.href = payload.redirect || "/platform/organizations";
    } catch {
      window.location.href = "/platform/organizations";
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-500/15 px-4 py-2 text-sm text-amber-800 dark:text-amber-300">
      <span className="flex items-center gap-2">
        <ShieldAlert className="size-4 shrink-0" />
        Viewing as <strong className="font-semibold">{accountName}</strong> — actions you take
        are on their behalf.
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={exit}
        disabled={loading}
        className="shrink-0 border-amber-500/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 dark:text-amber-300"
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : null}
        Return to admin
      </Button>
    </div>
  );
}
