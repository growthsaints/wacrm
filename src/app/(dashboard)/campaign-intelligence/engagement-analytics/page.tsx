"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EngagementAnalytics } from "@/lib/enterprise/queries";

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

export default function EngagementAnalyticsPage() {
  const [data, setData] = useState<EngagementAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/enterprise/engagement-analytics")
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
        Engagement Analytics isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label="Read Rate" value={`${data.readRate}%`} />
        <Tile label="Reply Rate" value={`${data.replyRate}%`} />
        <Tile
          label="Best Sending Hour"
          value={data.bestSendingHour !== null ? `${data.bestSendingHour}:00` : "Not enough data"}
        />
        <Tile label="Best Sending Day" value={data.bestSendingDay ?? "Not enough data"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Campaign</CardTitle>
        </CardHeader>
        <CardContent>
          {data.topCampaign ? (
            <p className="text-sm text-foreground">
              {data.topCampaign.name} — {data.topCampaign.readRate}% read rate
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No broadcasts sent yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Template</CardTitle>
        </CardHeader>
        <CardContent>
          {data.topTemplate ? (
            <p className="text-sm text-foreground">
              {data.topTemplate.name} — {data.topTemplate.readRate}% read rate
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No broadcasts sent yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
