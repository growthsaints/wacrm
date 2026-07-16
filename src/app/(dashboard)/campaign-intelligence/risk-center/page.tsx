"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { RiskCenter } from "@/lib/enterprise/queries";

function RiskBadge({ level }: { level: "low" | "medium" | "high" }) {
  return (
    <Badge
      className={cn(
        level === "high" && "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
        level === "medium" && "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        level === "low" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      )}
    >
      {level}
    </Badge>
  );
}

export default function RiskCenterPage() {
  const [data, setData] = useState<RiskCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/enterprise/risk-center")
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setData(json.risk ?? null);
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
        Risk Center isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Quality Risk</p>
          <div className="mt-1">
            <RiskBadge level={data.qualityRisk} />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Campaign Risk</p>
          <div className="mt-1">
            <RiskBadge level={data.campaignRisk} />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Inactive Contacts</p>
          <p className="mt-1 text-xl font-semibold text-foreground">{data.inactiveContacts}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Rejected Templates</p>
          <p className="mt-1 text-xl font-semibold text-foreground">{data.rejectedTemplates}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Warnings</CardTitle>
        </CardHeader>
        <CardContent>
          {data.warnings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No risk warnings right now.</p>
          ) : (
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground">
              {data.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
