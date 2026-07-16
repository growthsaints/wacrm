"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Gauge, LineChart, Loader2, OctagonAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart } from "@/components/tremor/bar-chart";
import { cn } from "@/lib/utils";
import type { AccountHealth } from "@/lib/enterprise/queries";

export default function AccountHealthPage() {
  const [data, setData] = useState<AccountHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/enterprise/account-health")
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setData(json.health ?? null);
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
        Account Health isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Overall Score</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{data.score}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Quality Rating</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{data.qualityRating ?? "—"}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Failure Rate</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{data.failureRate}%</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Reply Rate</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{data.replyRate}%</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LineChart className="h-4 w-4 text-primary" /> Health Score Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.history.length < 2 ? (
            <p className="text-sm text-muted-foreground">
              History starts accumulating once the daily snapshot has run more
              than once — check back tomorrow. There&apos;s no way to backfill
              scores from before this was wired up.
            </p>
          ) : (
            <BarChart
              data={data.history.map((h) => ({
                date: new Date(h.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                Score: h.score,
              }))}
              index="date"
              categories={["Score"]}
              colors={["theme1"]}
              showLegend={false}
              yAxisWidth={32}
              className="h-40"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4 text-primary" /> Warnings &amp; Recommendations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.warnings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No warnings right now — your account looks healthy.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {data.warnings.map((w) => (
                <div
                  key={w.id}
                  className={cn(
                    "rounded-lg border px-4 py-3",
                    w.severity === "critical"
                      ? "border-red-500/30 bg-red-500/10"
                      : "border-amber-500/30 bg-amber-500/10",
                  )}
                >
                  <div className="flex items-start gap-2">
                    {w.severity === "critical" ? (
                      <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    )}
                    <div>
                      <p
                        className={cn(
                          "text-sm font-medium",
                          w.severity === "critical"
                            ? "text-red-700 dark:text-red-300"
                            : "text-amber-700 dark:text-amber-300",
                        )}
                      >
                        {w.message}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{w.recommendation}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
