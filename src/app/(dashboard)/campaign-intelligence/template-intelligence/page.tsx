"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TemplateIntelligenceRow } from "@/lib/enterprise/queries";

export default function TemplateIntelligencePage() {
  const [data, setData] = useState<TemplateIntelligenceRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/enterprise/template-intelligence")
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setData(json.templates ?? null);
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
        Template Intelligence isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Template</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Times Sent</TableHead>
            <TableHead>Delivery Rate</TableHead>
            <TableHead>Read Rate</TableHead>
            <TableHead>Reply Rate</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No templates yet.
              </TableCell>
            </TableRow>
          ) : (
            data.map((t) => (
              <TableRow key={`${t.name}::${t.language}`}>
                <TableCell>
                  <p className="font-medium text-foreground">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.category} · {t.language}</p>
                </TableCell>
                <TableCell>
                  <Badge variant={t.status === "Approved" ? "default" : t.status === "Rejected" ? "destructive" : "outline"}>
                    {t.status}
                  </Badge>
                </TableCell>
                <TableCell className="tabular-nums">{t.timesSent}</TableCell>
                <TableCell className="tabular-nums">{t.deliveryRate}%</TableCell>
                <TableCell className="tabular-nums">{t.readRate}%</TableCell>
                <TableCell className="tabular-nums">{t.replyRate}%</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
