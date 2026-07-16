"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReportPeriod, WorkspaceReport } from "@/lib/business-workspace/queries";

const PERIODS: { value: ReportPeriod; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

export default function ReportsPage() {
  const [period, setPeriod] = useState<ReportPeriod>("weekly");
  const [report, setReport] = useState<WorkspaceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/business-workspace/reports?period=${period}`)
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setReport(json.report ?? null);
      })
      .finally(() => setLoading(false));
  }, [period]);

  if (notEnabled) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Reports isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          One consolidated report per period — customer, lead, performance,
          and activity numbers together rather than six separate reports.
        </p>
        <Select value={period} onValueChange={(v) => setPeriod((v as ReportPeriod) ?? "weekly")}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading || !report ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {new Date(report.rangeStart).toLocaleDateString()} – {new Date(report.rangeEnd).toLocaleDateString()}
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">New Customers</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-foreground">{report.newCustomers}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">New Leads</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-foreground">{report.newLeads}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">Deals Won / Lost</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-foreground">
                  {report.dealsWon} / {report.dealsLost}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">Conversations Closed</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-foreground">{report.conversationsClosed}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">Notes Added</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-foreground">{report.notesAdded}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">Top Agent</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg font-semibold text-foreground">{report.topAgent?.name ?? "—"}</p>
                {report.topAgent && (
                  <p className="text-xs text-muted-foreground">{report.topAgent.conversationsClosed} conversations closed</p>
                )}
              </CardContent>
            </Card>
          </div>

          {report.notTrackedYet.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {report.notTrackedYet.map((label) => (
                <Badge key={label} variant="outline" className="text-muted-foreground">
                  {label}
                </Badge>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
