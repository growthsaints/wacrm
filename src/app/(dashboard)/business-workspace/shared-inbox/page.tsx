"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Pin, Search } from "lucide-react";
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
import type { SharedInboxResult } from "@/lib/business-workspace/queries";

const STATUSES = ["open", "pending", "closed", "archived"];
const ANY = "__any__";

export default function SharedInboxPage() {
  const [data, setData] = useState<SharedInboxResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);

    fetch(`/api/business-workspace/shared-inbox?${params.toString()}`)
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setData(json ?? null);
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
        Shared Inbox isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        A team-wide view across every conversation — assign, pin, and filter
        here, then open a thread in the Inbox to actually chat.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone…"
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

      <div className="rounded-lg border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead>Last Message</TableHead>
              <TableHead>Unread</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center">
                  <Loader2 className="mx-auto size-6 animate-spin text-primary" />
                </TableCell>
              </TableRow>
            ) : !data || data.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                  No conversations match these filters.
                </TableCell>
              </TableRow>
            ) : (
              data.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      {r.isPinned && <Pin className="size-3 text-primary" />}
                      {r.contactName || r.contactPhone}
                      {r.channel === "personal_whatsapp" && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          Personal WhatsApp
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={cn(
                        r.status === "open" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
                        r.status === "closed" && "border-muted-foreground/30 bg-muted text-muted-foreground",
                      )}
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.assignedAgentName ?? "Unassigned"}</TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                    {r.lastMessageText ?? "—"}
                  </TableCell>
                  <TableCell>
                    {r.unreadCount > 0 ? <Badge variant="secondary">{r.unreadCount}</Badge> : "—"}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={
                        r.channel === "personal_whatsapp"
                          ? `/business-workspace/personal-inbox?conversation=${r.id}`
                          : `/inbox?c=${r.id}`
                      }
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Open <ExternalLink className="size-3" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data && data.notTrackedYet.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.notTrackedYet.map((label) => (
            <Badge key={label} variant="outline" className="text-muted-foreground">
              {label}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
