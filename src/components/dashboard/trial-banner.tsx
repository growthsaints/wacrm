"use client";

// ============================================================
// TrialBanner — shown across the top of the dashboard once an
// account's 14-day trial has passed with no active paid plan and no
// Super Admin free-forever grant (see /api/billing/plan's
// trialExpired computation). Banner-only, by design — it never blocks
// access; that gating decision was deliberately left off, same as the
// billing/subscription route's own comment about plan_status.
// Owner only, same visibility rule as TopStatusBar.
// ============================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TrialBanner() {
  const { canEditSettings, accountId } = useAuth();
  const [trialExpired, setTrialExpired] = useState(false);

  useEffect(() => {
    if (!canEditSettings || !accountId) return;
    let cancelled = false;
    fetch("/api/billing/plan", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setTrialExpired(Boolean(data.trialExpired));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canEditSettings, accountId]);

  if (!canEditSettings || !trialExpired) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-500/15 px-4 py-2 text-sm text-amber-800 dark:text-amber-300">
      <span className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" />
        Your free trial has ended — subscribe to keep full access to the CRM.
      </span>
      <Link
        href="/settings?tab=billing"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "shrink-0 border-amber-500/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 dark:text-amber-300",
        )}
      >
        Subscribe now
      </Link>
    </div>
  );
}
