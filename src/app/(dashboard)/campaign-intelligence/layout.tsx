"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnterpriseFeatures } from "@/hooks/use-enterprise-features";

const LIVE_TABS = [
  { href: "/campaign-intelligence", label: "Overview" },
  { href: "/campaign-intelligence/account-health", label: "Account Health" },
  { href: "/campaign-intelligence/contact-intelligence", label: "Contact Intelligence" },
  { href: "/campaign-intelligence/campaign-analyzer", label: "Campaign Analyzer" },
  { href: "/campaign-intelligence/broadcast-queue", label: "Broadcast Queue" },
  { href: "/campaign-intelligence/delivery-insights", label: "Delivery Insights" },
  { href: "/campaign-intelligence/engagement-analytics", label: "Engagement Analytics" },
  { href: "/campaign-intelligence/template-intelligence", label: "Template Intelligence" },
  { href: "/campaign-intelligence/warmup-center", label: "Warm-up Center" },
  { href: "/campaign-intelligence/risk-center", label: "Risk Center" },
  { href: "/campaign-intelligence/compliance-center", label: "Compliance Center" },
  { href: "/campaign-intelligence/ai-recommendations", label: "AI Recommendations" },
  { href: "/campaign-intelligence/automation-rules", label: "Automation Rules" },
];

const COMING_SOON_TABS: string[] = [];

export default function CampaignIntelligenceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { loading, enabled: licensed, features } = useEnterpriseFeatures();
  const enabled = licensed && Boolean(features.campaign_intelligence);

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
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Building2 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Campaign Intelligence &amp; Account Health Center
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-border pb-px">
        {LIVE_TABS.map((tab) => {
          const isActive =
            tab.href === "/campaign-intelligence"
              ? pathname === tab.href
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "rounded-t-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-b-2 border-primary text-primary"
                  : "border-b-2 border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
        {COMING_SOON_TABS.map((label) => (
          <span
            key={label}
            title="Coming soon"
            className="cursor-default rounded-t-lg border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground/40"
          >
            {label}
          </span>
        ))}
      </div>

      {children}
    </div>
  );
}
