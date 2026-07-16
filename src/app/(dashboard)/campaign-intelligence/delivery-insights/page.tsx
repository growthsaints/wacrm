"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { DeliveryInsights } from "@/lib/enterprise/queries";

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">{value.toLocaleString()}</p>
    </div>
  );
}

export default function DeliveryInsightsPage() {
  const [data, setData] = useState<DeliveryInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/enterprise/delivery-insights")
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setData(json.insights ?? null);
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
        Delivery Insights isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <Tile label="Submitted" value={data.submitted} />
        <Tile label="Accepted" value={data.accepted} />
        <Tile label="Delivered" value={data.delivered} />
        <Tile label="Read" value={data.read} />
        <Tile label="Failed" value={data.failed} />
        <Tile label="Pending" value={data.pending} />
        <Tile label="Replies" value={data.replies} />
        <Tile label="Unique Recipients" value={data.uniqueRecipients} />
        <Tile label="Template Delivered" value={data.templateDelivered} />
        <Tile label="Media Delivered" value={data.mediaDelivered} />
      </div>
      <p className="text-xs text-muted-foreground">
        Aggregated across every broadcast campaign on this account.
      </p>
    </div>
  );
}
