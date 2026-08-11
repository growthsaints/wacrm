"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";

interface MessageHistoryRow {
  id: string;
  content_text: string | null;
  content_type: string;
  sender_type: "customer" | "agent" | "bot";
  status: string;
  created_at: string;
  conversations: {
    contacts: { id: string; name: string | null; phone: string } | null;
  } | null;
}

const DIRECTIONS = [
  { value: "all", label: "All directions" },
  { value: "customer", label: "From customer" },
  { value: "agent", label: "From agent" },
  { value: "bot", label: "From bot / automation" },
];

const SENDER_BADGE: Record<string, string> = {
  customer: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  agent: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  bot: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
};

export default function MessageHistoryPage() {
  const [q, setQ] = useState("");
  const [direction, setDirection] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [rows, setRows] = useState<MessageHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (q.trim()) params.set("q", q.trim());
    if (direction !== "all") params.set("direction", direction);

    fetch(`/api/business-workspace/message-history?${params.toString()}`)
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setRows(json.messages ?? []);
        setTotal(json.total ?? 0);
      })
      .finally(() => setLoading(false));
  }, [q, direction, page, pageSize]);

  if (notEnabled) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Reports isn&apos;t enabled for your account.
      </p>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link
          href="/business-workspace/reports"
          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Message History</h1>
          <p className="text-xs text-muted-foreground">
            Every message across every conversation — searchable, not scoped to one contact or broadcast.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder="Search message text..."
            className="pl-8"
          />
        </div>
        <Select
          value={direction}
          onValueChange={(v) => {
            setPage(1);
            setDirection(v ?? "all");
          }}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DIRECTIONS.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No messages match these filters.
        </p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium text-foreground">
                    {row.conversations?.contacts?.name || row.conversations?.contacts?.phone || "—"}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${SENDER_BADGE[row.sender_type] ?? ""}`}
                    >
                      {row.sender_type}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-md truncate text-sm text-muted-foreground">
                    {row.content_text || `[${row.content_type}]`}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize text-muted-foreground">
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted-foreground">
              {total} message{total === 1 ? "" : "s"} · page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
