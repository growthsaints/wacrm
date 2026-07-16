"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { createClient } from "@/lib/supabase/client";
import type { CustomerHubRow } from "@/lib/business-workspace/queries";

const PRIORITIES = ["low", "medium", "high", "urgent"];
const STATUSES = ["active", "inactive", "vip", "churned"];
const ANY = "__any__";

interface Profile {
  id: string;
  full_name: string | null;
  email: string;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export default function CustomerHubPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<CustomerHubRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [assignedAgent, setAssignedAgent] = useState<string>("");
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .order("full_name")
      .then(({ data }) => setProfiles((data as Profile[]) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (priority) params.set("priority", priority);
    if (status) params.set("status", status);
    if (assignedAgent) params.set("assignedAgent", assignedAgent);

    fetch(`/api/business-workspace/customer-hub?${params.toString()}`)
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
  }, [search, priority, status, assignedAgent]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  async function updateField(contactId: string, field: "priority" | "status" | "assignedAgentId", value: string | null) {
    const res = await fetch(`/api/business-workspace/customer-hub/${contactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) {
      toast.error("Failed to update.");
      return;
    }
    load();
  }

  function exportCsv() {
    const header = ["Name", "Phone", "Email", "Source", "Priority", "Status", "Segment", "Assigned Agent", "Customer Score"];
    const lines = rows.map((r) =>
      [
        r.name ?? "",
        r.phone,
        r.email ?? "",
        r.source ?? "",
        r.priority ?? "",
        r.workspaceStatus ?? "",
        r.segment ?? "",
        r.assignedAgentName ?? "",
        r.customerScore?.toString() ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "customer-hub-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (notEnabled) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Customer Hub isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, or email…"
            className="pl-8"
          />
        </div>
        <Select value={priority || ANY} onValueChange={(v) => setPriority(v === ANY ? "" : v ?? "")}>
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any Priority</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p} className="capitalize">
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        <Select value={assignedAgent || ANY} onValueChange={(v) => setAssignedAgent(v === ANY ? "" : v ?? "")}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Assigned Agent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any Agent</SelectItem>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.full_name || p.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0} className="sm:ml-auto">
          <Download className="size-4" /> Export
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{totalCount.toLocaleString()} customers</p>

      <div className="rounded-lg border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assigned Agent</TableHead>
              <TableHead>Last Activity</TableHead>
              <TableHead>Customer Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="py-12 text-center">
                  <Loader2 className="mx-auto size-6 animate-spin text-primary" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                  No customers match these filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-foreground">
                    <Link href={`/business-workspace/customer-360?contact=${r.id}`} className="hover:text-primary">
                      {r.name || <span className="text-muted-foreground italic">Unnamed</span>}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.phone}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.source ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {r.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                          style={{ backgroundColor: tag.color + "20", color: tag.color }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select value={r.priority ?? ANY} onValueChange={(v) => updateField(r.id, "priority", v === ANY ? null : v)}>
                      <SelectTrigger className="h-8 w-28">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ANY}>—</SelectItem>
                        {PRIORITIES.map((p) => (
                          <SelectItem key={p} value={p} className="capitalize">
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select value={r.workspaceStatus ?? ANY} onValueChange={(v) => updateField(r.id, "status", v === ANY ? null : v)}>
                      <SelectTrigger className="h-8 w-28">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ANY}>—</SelectItem>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s} className="capitalize">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={r.assignedAgentId ?? ANY}
                      onValueChange={(v) => updateField(r.id, "assignedAgentId", v === ANY ? null : v)}
                    >
                      <SelectTrigger className="h-8 w-36">
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ANY}>Unassigned</SelectItem>
                        {profiles.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.full_name || p.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.lastActivity ? new Date(r.lastActivity).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell>
                    {r.customerScore !== null ? <Badge variant="secondary">{r.customerScore}</Badge> : "—"}
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
