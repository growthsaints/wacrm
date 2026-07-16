"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { DealsListRow } from "@/lib/business-workspace/queries";

const STATUSES = ["open", "won", "lost"];
const ANY = "__any__";

export default function BusinessWorkspaceDealsPage() {
  const [rows, setRows] = useState<DealsListRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);

    fetch(`/api/business-workspace/deals?${params.toString()}`)
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setRows(json.rows ?? []);
        setTotalCount(json.totalCount ?? 0);
      })
      .finally(() => setLoading(false));
  }, [search, status]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  if (notEnabled) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Deals isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        A flat, sortable view across every pipeline stage — the same `deals`
        data as the Pipelines Kanban board, just listed instead of boarded.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search deal title…"
            className="pl-8"
          />
        </div>
        <Select value={status || ANY} onValueChange={(v) => setStatus(v === ANY ? "" : v ?? "")}>
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any Status</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground">{totalCount.toLocaleString()} deals</p>

      <div className="rounded-lg border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Deal</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead>Expected Close</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center">
                  <Loader2 className="mx-auto size-6 animate-spin text-primary" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                  No deals match these filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium text-foreground">{d.title}</TableCell>
                  <TableCell>
                    <Link
                      href={`/business-workspace/customer-360?contact=${d.contactId}`}
                      className="text-sm text-muted-foreground hover:text-primary"
                    >
                      {d.contactName ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{d.stageName ?? "—"}</TableCell>
                  <TableCell>
                    <Badge
                      className={cn(
                        d.status === "won" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
                        d.status === "lost" && "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
                        d.status === "open" && "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400",
                      )}
                    >
                      {d.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-foreground">
                    {d.currency ?? ""} {d.value.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{d.assignedToName ?? "Unassigned"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {d.expectedCloseDate ? new Date(d.expectedCloseDate).toLocaleDateString() : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
