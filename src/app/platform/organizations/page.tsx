"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Search, Wifi, WifiOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Organization {
  id: string;
  name: string;
  status: "active" | "suspended";
  createdAt: string;
  memberCount: number;
  whatsappStatus: string;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function OrganizationsPage() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);

  const load = useCallback((q: string, p: number) => {
    setLoading(true);
    fetch(`/api/platform/organizations?q=${encodeURIComponent(q)}&page=${p}`, {
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data: {
        organizations: Organization[];
        total: number;
        pageSize: number;
      }) => {
        setOrgs(data.organizations ?? []);
        setTotal(data.total ?? 0);
        setPageSize(data.pageSize ?? 25);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => load(query, page), 200);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Organizations</h1>
          <p className="text-sm text-muted-foreground">
            Every tenant on Growth Saints CRM — {total} total.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setPage(1);
              setQuery(e.target.value);
            }}
            placeholder="Search by name…"
            className="pl-8"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : orgs.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No organizations match &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgs.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell>
                      <Link
                        href={`/platform/organizations/${org.id}`}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {org.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={org.status === "suspended" ? "destructive" : "secondary"}>
                        {org.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{org.memberCount}</TableCell>
                    <TableCell>
                      {org.whatsappStatus === "connected" ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                          <Wifi className="size-3.5" /> Connected
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <WifiOff className="size-3.5" /> Not connected
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {fmtDate(org.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-4" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
