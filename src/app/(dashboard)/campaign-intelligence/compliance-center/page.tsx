"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ComplianceCenter } from "@/lib/enterprise/queries";

export default function ComplianceCenterPage() {
  const [data, setData] = useState<ComplianceCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/enterprise/compliance-center")
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setData(json.compliance ?? null);
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
        Compliance Center isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Display Name</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{data.displayName ?? "—"}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Phone Status</p>
          <p className="mt-1 text-sm font-semibold text-foreground capitalize">{data.phoneStatus}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Messaging Tier</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{data.messagingLimitTier ?? "—"}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Quality Rating</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{data.qualityRating ?? "—"}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Failed Messages (lifetime)</p>
          <p className="mt-1 text-xl font-semibold text-foreground">{data.totalFailedMessages.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Unresolved Flagged Events</p>
          <p className="mt-1 text-xl font-semibold text-foreground">{data.unresolvedFlaggedEvents.toLocaleString()}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Errors</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentErrors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No broadcast failures or account-level events recorded.</p>
          ) : (
            <ul className="space-y-2">
              {data.recentErrors.map((e) => (
                <li
                  key={e.id}
                  className={cn(
                    "flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm",
                    e.flagged ? "border-red-500/30 bg-red-500/5" : "border-border",
                  )}
                >
                  <span className="flex items-start gap-2">
                    {e.flagged ? (
                      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-red-500" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="text-foreground">{e.message}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant="outline" className="text-[10px] capitalize text-muted-foreground">
                      {e.source === "broadcast_failure" ? "Broadcast" : "Account Event"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
