"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WorkspaceAnalytics } from "@/lib/business-workspace/queries";

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<WorkspaceAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/business-workspace/analytics")
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setData(json.analytics ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (notEnabled || !data) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Analytics isn&apos;t enabled for your account.
      </p>
    );
  }

  const maxGrowth = Math.max(1, ...data.customerGrowth.map((w) => w.count));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatTile label="Total Customers" value={data.customers.total.toLocaleString()} />
        <StatTile label="New This Week" value={data.customers.newThisWeek.toLocaleString()} />
        <StatTile label="Open Leads" value={data.leads.open.toLocaleString()} />
        <StatTile label="Lead Conversion" value={`${data.leads.conversionRate}%`} />
        <StatTile label="Open Conversations" value={data.conversations.open.toLocaleString()} />
        <StatTile label="Pending Follow-ups" value={data.followups.pending.toLocaleString()} />
        <StatTile label="Retention Rate (30d)" value={`${data.retentionRate}%`} />
        <StatTile label="Closed Conversations" value={data.conversations.closed.toLocaleString()} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customer Growth (8 weeks)</CardTitle>
          </CardHeader>
          <CardContent>
            {data.customerGrowth.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not enough data yet.</p>
            ) : (
              <div className="flex h-32 items-end gap-1.5">
                {data.customerGrowth.map((w) => (
                  <div key={w.weekStart} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-primary/70"
                      style={{ height: `${Math.max(4, (w.count / maxGrowth) * 100)}%` }}
                      title={`${w.count} new customers`}
                    />
                    <span className="text-[9px] text-muted-foreground">
                      {new Date(w.weekStart).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Label Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {data.labelDistribution.length === 0 ? (
              <p className="text-sm text-muted-foreground">No labels created yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.labelDistribution.slice(0, 8).map((l) => (
                  <li key={l.name} className="flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: l.color }} />
                      {l.name}
                    </span>
                    <span className="text-muted-foreground">{l.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Customers by Source</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5">
            {data.customers.bySource.map((s) => (
              <li key={s.source} className="flex items-center justify-between text-sm">
                <span className="capitalize text-foreground">{s.source}</span>
                <span className="text-muted-foreground">{s.count}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {data.notTrackedYet.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.notTrackedYet.map((label) => (
            <Badge key={label} variant="outline" className="text-muted-foreground">
              {label}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
