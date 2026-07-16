"use client";

import { Building2, Loader2 } from "lucide-react";
import { useEnterpriseFeatures } from "@/hooks/use-enterprise-features";

/**
 * Campaign Intelligence & Account Health Center — landing page.
 *
 * Phase 1 ships the licensing foundation (feature flags, Super Admin
 * management, sidebar gating, this page's own access check) with a
 * placeholder here. The thirteen real sub-pages (Overview, Account
 * Health, Delivery Insights, etc.) are later phases, each backed by
 * real data rather than placeholder numbers.
 *
 * This page re-checks access itself rather than trusting that the
 * sidebar simply didn't render a link to it — a hidden menu item is
 * not an access control.
 */
export default function CampaignIntelligencePage() {
  const { loading, enabled } = useEnterpriseFeatures();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Building2 className="size-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Campaign Intelligence isn&apos;t available on your account
          </h1>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            This is an Enterprise add-on. Contact support if you&apos;d like to
            enable it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Building2 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Campaign Intelligence &amp; Account Health Center
        </h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Your account has Enterprise access. Overview, Account Health,
        Delivery Insights, and the rest of this module are on the way —
        this page will fill in as each part ships.
      </p>
    </div>
  );
}
