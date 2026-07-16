"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBusinessWorkspaceFeatures } from "@/hooks/use-business-workspace-features";

const LIVE_TABS = [
  { href: "/business-workspace", label: "Overview" },
  { href: "/business-workspace/customer-hub", label: "Customer Hub" },
  { href: "/business-workspace/customer-360", label: "Customer 360" },
  { href: "/business-workspace/team-workspace", label: "Team Workspace" },
  { href: "/business-workspace/labels", label: "Labels" },
  { href: "/business-workspace/notes", label: "Notes" },
  { href: "/business-workspace/deals", label: "Deals" },
];

const COMING_SOON_TABS = [
  "Shared Inbox",
  "AI Assistant",
  "Follow-up Center",
  "Calendar",
  "Campaign Planner",
  "Analytics",
  "Reports",
];

export default function BusinessWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { loading, enabled } = useBusinessWorkspaceFeatures();

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
          <Briefcase className="size-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Business Workspace isn&apos;t available on your account
          </h1>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            This is a premium add-on. Contact support if you&apos;d like to
            enable it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Briefcase className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Business Workspace&trade;
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-border pb-px">
        {LIVE_TABS.map((tab) => {
          const isActive =
            tab.href === "/business-workspace"
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
