"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WarmupCenter } from "@/lib/enterprise/queries";

export default function WarmupCenterPage() {
  const [data, setData] = useState<WarmupCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/enterprise/warmup-center")
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setData(json.warmup ?? null);
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
        Warm-up Center isn&apos;t enabled for your account.
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
          <p className="text-xs text-muted-foreground">Quality Rating</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{data.qualityRating ?? "—"}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Messaging Tier</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{data.messagingLimitTier ?? "—"}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Connected Since</p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {data.connectedSince ? new Date(data.connectedSince).toLocaleDateString() : "—"}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> Recommendations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-2 pl-5 text-sm text-foreground">
            {data.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Meta scales your messaging tier automatically based on quality and
            usage — there&apos;s no way to manually increase it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
