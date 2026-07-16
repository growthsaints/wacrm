"use client";

import { useEffect, useState } from "react";
import { Info, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Errors</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              API and webhook error logging isn&apos;t tracked yet — this
              section will show real failures once that&apos;s built, rather
              than a fabricated &quot;0 errors&quot; count.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
