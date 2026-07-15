"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Signal, Wifi, WifiOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface WhatsAppNumber {
  accountId: string;
  organizationName: string;
  businessName: string | null;
  displayName: string | null;
  displayPhoneNumber: string | null;
  status: "connected" | "disconnected";
  qualityRating: string | null;
  messagingLimitTier: string | null;
  codeVerificationStatus: string | null;
  onboardingMethod: "manual" | "embedded_signup";
  lastSyncedAt: string | null;
  connectedAt: string | null;
  createdAt: string;
  health: "healthy" | "action_needed" | "disconnected";
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function HealthBadge({ health }: { health: WhatsAppNumber["health"] }) {
  if (health === "healthy") {
    return (
      <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
        <CheckCircle2 className="size-3" />
        Healthy
      </Badge>
    );
  }
  if (health === "action_needed") {
    return (
      <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300">
        <Signal className="size-3" />
        Action needed
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <WifiOff className="size-3" />
      Disconnected
    </Badge>
  );
}

interface ReconcileResult {
  configured: boolean;
  metaTotal?: number;
  dbTotal?: number;
  missingFromMeta?: {
    accountId: string;
    organizationName: string;
    wabaId: string;
    businessName: string | null;
    displayPhoneNumber: string | null;
  }[];
  missingFromDb?: { wabaId: string; name: string | null }[];
}

function ReconcileWithMeta() {
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [checking, setChecking] = useState(false);

  async function runCheck() {
    setChecking(true);
    try {
      const res = await fetch("/api/platform/whatsapp/reconcile", { cache: "no-store" });
      const data: ReconcileResult = await res.json();
      setResult(data);
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Reconcile with Meta</CardTitle>
          <p className="text-sm text-muted-foreground">
            Compares our database against what Meta&apos;s Business Manager currently shows —
            catches drift from a manual DB edit or access revoked on Meta&apos;s side.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={runCheck} disabled={checking}>
          {checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Check now
        </Button>
      </CardHeader>
      {result && (
        <CardContent className="space-y-3 pt-0">
          {!result.configured ? (
            <p className="text-sm text-muted-foreground">
              Not configured — set <code>META_BUSINESS_ID</code> and{" "}
              <code>META_SYSTEM_USER_TOKEN</code> to enable this check.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Meta reports {result.metaTotal} WABA(s); our database has {result.dbTotal}.
              </p>
              {(result.missingFromMeta?.length ?? 0) === 0 &&
              (result.missingFromDb?.length ?? 0) === 0 ? (
                <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-300">
                  <CheckCircle2 className="size-4" /> No drift found.
                </p>
              ) : (
                <>
                  {result.missingFromMeta && result.missingFromMeta.length > 0 && (
                    <div className="space-y-1">
                      <p className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-300">
                        <AlertTriangle className="size-4" /> In our database, but Meta no longer
                        lists it (access likely revoked or disconnected on Meta&apos;s side):
                      </p>
                      <ul className="list-inside list-disc text-sm text-muted-foreground">
                        {result.missingFromMeta.map((m) => (
                          <li key={m.wabaId}>
                            {m.organizationName} — {m.businessName || m.displayPhoneNumber || m.wabaId}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.missingFromDb && result.missingFromDb.length > 0 && (
                    <div className="space-y-1">
                      <p className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-300">
                        <AlertTriangle className="size-4" /> Meta shows access to these, but we
                        have no matching row (an incomplete signup or a manual DB deletion):
                      </p>
                      <ul className="list-inside list-disc text-sm text-muted-foreground">
                        {result.missingFromDb.map((m) => (
                          <li key={m.wabaId}>{m.name || m.wabaId}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function PlatformWhatsAppPage() {
  const [numbers, setNumbers] = useState<WhatsAppNumber[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/platform/whatsapp", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { numbers?: WhatsAppNumber[] }) => {
        if (!cancelled) setNumbers(data.numbers ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">WhatsApp numbers</h1>
        <p className="text-sm text-muted-foreground">
          Every connected WhatsApp Business number across every organization — {numbers.length} total.
        </p>
      </div>

      <ReconcileWithMeta />

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : numbers.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No organization has connected a WhatsApp number yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Business</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Quality</TableHead>
                  <TableHead>Onboarding</TableHead>
                  <TableHead>Last sync</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {numbers.map((n) => (
                  <TableRow key={n.accountId}>
                    <TableCell>
                      <Link
                        href={`/platform/organizations/${n.accountId}`}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {n.organizationName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {n.businessName || n.displayName || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {n.displayPhoneNumber || "—"}
                    </TableCell>
                    <TableCell>
                      <HealthBadge health={n.health} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {n.qualityRating || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {n.onboardingMethod === "embedded_signup" ? (
                          <>
                            <Wifi className="size-3" /> Embedded Signup
                          </>
                        ) : (
                          "Manual"
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {fmtDateTime(n.lastSyncedAt)}
                    </TableCell>
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
