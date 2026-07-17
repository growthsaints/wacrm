"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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

interface CoreFeatureTenant {
  accountId: string;
  companyName: string;
  planType: string;
  planStatus: string;
  status: string;
  createdAt: string;
  accessType: string;
  expiryDate: string | null;
  features: { broadcasts: boolean; automations: boolean; ai_agents: boolean };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function CoreFeatureManagerPage() {
  const [tenants, setTenants] = useState<CoreFeatureTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/platform/core-features", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { tenants: CoreFeatureTenant[] }) => setTenants(data.tenants ?? []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = tenants.filter((t) =>
    t.companyName.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Core Feature Manager</h1>
          <p className="text-sm text-muted-foreground">
            Grant or restrict Broadcasts, Automations, and AI Agents per tenant
            — independent of their billing plan. A tenant with no changes
            here keeps full access by default.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by company name…"
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
          ) : filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No tenants match &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Subscription Plan</TableHead>
                  <TableHead>Broadcasts</TableHead>
                  <TableHead>Automations</TableHead>
                  <TableHead>AI Agents</TableHead>
                  <TableHead>Access Type</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t) => (
                  <TableRow key={t.accountId}>
                    <TableCell>
                      <Link
                        href={`/platform/core-features/${t.accountId}`}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {t.companyName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{t.planType}</TableCell>
                    <TableCell>
                      <Badge variant={t.features.broadcasts ? "default" : "outline"}>
                        {t.features.broadcasts ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.features.automations ? "default" : "outline"}>
                        {t.features.automations ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.features.ai_agents ? "default" : "outline"}>
                        {t.features.ai_agents ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground capitalize">
                      {t.accessType === "none" ? "—" : t.accessType.replace("_", " ")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.expiryDate ? fmtDate(t.expiryDate) : "No expiry"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(t.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
