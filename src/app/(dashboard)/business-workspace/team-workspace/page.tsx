"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { TeamWorkspaceResult } from "@/lib/business-workspace/queries";

function PresenceDot({ status }: { status: "online" | "away" | "offline" }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        status === "online" && "bg-emerald-500",
        status === "away" && "bg-amber-500",
        status === "offline" && "bg-muted-foreground/40",
      )}
    />
  );
}

export default function TeamWorkspacePage() {
  const [data, setData] = useState<TeamWorkspaceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/business-workspace/team-workspace")
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setData(json ?? null);
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
        Team Workspace isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roster &amp; Availability</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead>Conversations Closed (7d)</TableHead>
                <TableHead>Deals Won (7d)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium text-foreground">{m.fullName || m.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {m.accountRole}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm capitalize text-muted-foreground">
                      <PresenceDot status={m.presenceStatus} /> {m.presenceStatus}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-foreground">{m.conversationsClosedThisWeek}</TableCell>
                  <TableCell className="text-sm text-foreground">{m.dealsWonThisWeek}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coming Soon</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {data.notTrackedYet.map((label) => (
              <Badge key={label} variant="outline" className="text-muted-foreground">
                {label}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
