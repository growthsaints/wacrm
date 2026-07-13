"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Building2,
  Loader2,
  MessagesSquare,
  Radio,
  Users,
  Wifi,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Overview {
  accounts: { total: number; active: number; suspended: number };
  contacts: number;
  conversations: number;
  messages: { total: number; thisMonth: number };
  broadcasts: number;
  whatsappConnected: number;
  recentOrganizations: {
    id: string;
    name: string;
    status: "active" | "suspended";
    created_at: string;
  }[];
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Building2;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular-nums text-foreground">{value}</p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function PlatformDashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/platform/overview", { cache: "no-store" })
      .then((res) => res.json())
      .then((json: Overview) => {
        if (!cancelled) setData(json);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <p className="text-sm text-muted-foreground">Failed to load platform overview.</p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Platform overview</h1>
        <p className="text-sm text-muted-foreground">
          Usage across every organization on Growth Saints CRM.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Building2}
          label="Organizations"
          value={data.accounts.total}
          hint={`${data.accounts.active} active · ${data.accounts.suspended} suspended`}
        />
        <StatTile icon={Users} label="Contacts" value={data.contacts} />
        <StatTile
          icon={MessagesSquare}
          label="Messages"
          value={data.messages.total}
          hint={`${data.messages.thisMonth} this month`}
        />
        <StatTile icon={Radio} label="Broadcasts sent" value={data.broadcasts} />
        <StatTile icon={Wifi} label="WhatsApp numbers connected" value={data.whatsappConnected} />
        <StatTile icon={MessagesSquare} label="Conversations" value={data.conversations} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Recently created organizations</CardTitle>
          <Link
            href="/platform/organizations"
            className="text-sm text-primary hover:text-primary/80"
          >
            View all
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {data.recentOrganizations.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                No organizations yet.
              </li>
            ) : (
              data.recentOrganizations.map((org) => (
                <li key={org.id}>
                  <Link
                    href={`/platform/organizations/${org.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
                  >
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">
                      {org.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {fmtDate(org.created_at)}
                      </span>
                      {org.status === "suspended" && (
                        <Badge variant="destructive">suspended</Badge>
                      )}
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
