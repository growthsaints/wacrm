"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronsUpDown, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface OrgSummary {
  id: string;
  name: string;
  status: "active" | "suspended";
  memberCount: number;
}

/**
 * Jump directly to any tenant's organization detail page from anywhere
 * in the Super Admin section — the "workspace switching" affordance
 * for platform admins overseeing many tenants.
 */
export function WorkspaceSwitcher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback((q: string) => {
    setLoading(true);
    fetch(`/api/platform/organizations?q=${encodeURIComponent(q)}&page=1`, {
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : { organizations: [] }))
      .then((data: { organizations?: OrgSummary[] }) => setOrgs(data.organizations ?? []))
      .catch(() => setOrgs([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => search(query), 200);
    return () => clearTimeout(handle);
  }, [open, query, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted">
        <Building2 className="size-4 text-muted-foreground" />
        <span className="hidden sm:inline">Switch workspace</span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 p-0">
        <div className="border-b border-border p-2">
          <Input
            autoFocus
            placeholder="Search organizations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : orgs.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No organizations found.
            </p>
          ) : (
            orgs.map((org) => (
              <button
                key={org.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push(`/platform/organizations/${org.id}`);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <span className="min-w-0 flex-1 truncate text-foreground">{org.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {org.memberCount} {org.memberCount === 1 ? "member" : "members"}
                </span>
                {org.status === "suspended" && (
                  <Badge variant="destructive" className="shrink-0">
                    suspended
                  </Badge>
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
