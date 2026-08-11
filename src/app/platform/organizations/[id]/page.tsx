"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Gauge,
  Loader2,
  LogIn,
  MessagesSquare,
  Radio,
  Sparkles,
  Trash2,
  Users,
  Wallet,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Member {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  created_at: string;
}

type PlanType = "none" | "managed" | "self_serve_monthly" | "self_serve_quarterly";

const PLAN_LABEL: Record<PlanType, string> = {
  none: "Free Forever",
  managed: "Managed",
  self_serve_monthly: "Self-serve Monthly",
  self_serve_quarterly: "Self-serve Quarterly",
};

interface OrgDetail {
  organization: {
    id: string;
    name: string;
    status: "active" | "suspended";
    createdAt: string;
    defaultCurrency: string;
  };
  billing: {
    planType: PlanType;
    planStatus: "inactive" | "active" | "cancelled";
    planExpiresAt: string | null;
    planFreeGranted: boolean;
    walletBalance: number;
  };
  members: Member[];
  whatsapp: { configured: boolean; connected: boolean; connectedAt: string | null };
  quota: { tier: string | null; dailyCap: number | null; usedToday: number | null };
  whatsappAlerts: { id: string; field: string; rawValue: unknown; createdAt: string }[];
  usage: {
    members: number;
    contacts: number;
    conversations: number;
    messages: { total: number; thisMonth: number };
    broadcasts: number;
  };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [data, setData] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [confirmImpersonate, setConfirmImpersonate] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [makingFree, setMakingFree] = useState(false);
  const [revokingFree, setRevokingFree] = useState(false);
  const [walletInput, setWalletInput] = useState("");
  const [savingWallet, setSavingWallet] = useState(false);
  const [resolvingAlerts, setResolvingAlerts] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/platform/organizations/${id}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: OrgDetail | null) => setData(json))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // Seed the wallet input from the loaded balance once, so the admin
    // sees the current value pre-filled but their own in-progress edit
    // never gets clobbered by a background refresh.
    if (data && walletInput === "") setWalletInput(String(data.billing.walletBalance));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function makePlanFree() {
    setMakingFree(true);
    try {
      const res = await fetch(`/api/platform/organizations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ makeFree: true }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || "Failed to update plan");
        return;
      }
      toast.success("Plan reset to Free Forever");
      load();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setMakingFree(false);
    }
  }

  async function revokeFree() {
    setRevokingFree(true);
    try {
      const res = await fetch(`/api/platform/organizations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revokeFree: true }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || "Failed to revoke free plan");
        return;
      }
      toast.success("Free Forever grant revoked");
      load();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setRevokingFree(false);
    }
  }

  async function saveWalletBalance() {
    const balance = Number(walletInput);
    if (!Number.isFinite(balance) || balance < 0) {
      toast.error("Enter a valid, non-negative amount");
      return;
    }
    setSavingWallet(true);
    try {
      const res = await fetch(`/api/platform/organizations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletBalance: balance }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || "Failed to update wallet balance");
        return;
      }
      toast.success(`Wallet balance set to ₹${balance.toFixed(2)}`);
      load();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSavingWallet(false);
    }
  }

  async function resolveWhatsappAlerts() {
    setResolvingAlerts(true);
    try {
      const res = await fetch(`/api/platform/organizations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolveWhatsappAlerts: true }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || "Failed to resolve WhatsApp alerts");
        return;
      }
      toast.success("WhatsApp alerts marked resolved");
      load();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setResolvingAlerts(false);
    }
  }

  async function updateStatus(status: "active" | "suspended") {
    setStatusUpdating(true);
    try {
      const res = await fetch(`/api/platform/organizations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || "Failed to update organization");
        return;
      }
      toast.success(status === "suspended" ? "Organization suspended" : "Organization reinstated");
      setConfirmSuspend(false);
      load();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleDelete() {
    if (!data || deleteConfirmText !== data.organization.name) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/platform/organizations/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName: deleteConfirmText }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || "Failed to delete organization");
        return;
      }
      toast.success("Organization deleted");
      router.push("/platform/organizations");
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setDeleting(false);
    }
  }

  async function startImpersonation() {
    setImpersonating(true);
    try {
      const res = await fetch(`/api/platform/organizations/${id}/impersonate`, {
        method: "POST",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || "Failed to start impersonation");
        return;
      }
      // Full navigation (not router.push) — the session cookies just
      // changed under us, so the client needs a fresh load to pick up
      // the impersonated user's auth state.
      window.location.href = "/dashboard";
    } catch {
      toast.error("Network error — please try again");
      setImpersonating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">Organization not found.</p>;
  }

  const { organization, billing, members, whatsapp, quota, usage, whatsappAlerts } = data;
  const owner = members.find((m) => m.account_role === "owner");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">{organization.name}</h1>
            <Badge variant={organization.status === "suspended" ? "destructive" : "secondary"}>
              {organization.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Created {fmtDate(organization.createdAt)} · {organization.defaultCurrency}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            disabled={!owner || impersonating}
            onClick={() => setConfirmImpersonate(true)}
          >
            <LogIn className="size-4" />
            Log in as client
          </Button>
          {organization.status === "active" ? (
            <Button
              variant="destructive"
              disabled={statusUpdating}
              onClick={() => setConfirmSuspend(true)}
            >
              <Ban className="size-4" />
              Suspend
            </Button>
          ) : (
            <Button disabled={statusUpdating} onClick={() => updateStatus("active")}>
              <CheckCircle2 className="size-4" />
              Reinstate
            </Button>
          )}
          <Button
            variant="destructive"
            disabled={deleting}
            onClick={() => {
              setDeleteConfirmText("");
              setConfirmDelete(true);
            }}
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Users} label="Members" value={usage.members} />
        <StatCard icon={Users} label="Contacts" value={usage.contacts} />
        <StatCard
          icon={MessagesSquare}
          label="Messages"
          value={usage.messages.total}
          hint={`${usage.messages.thisMonth} this month`}
        />
        <StatCard icon={Radio} label="Broadcasts sent" value={usage.broadcasts} />
        {quota.dailyCap !== null && (
          <StatCard
            icon={Gauge}
            label="Broadcast quota today"
            value={quota.usedToday ?? 0}
            hint={`of ${quota.dailyCap.toLocaleString()} (${quota.tier})`}
          />
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Plan</p>
              <p className="text-sm font-medium text-foreground">
                {PLAN_LABEL[billing.planType]}
                {billing.planType !== "none" ? (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    ({billing.planStatus}
                    {billing.planExpiresAt ? ` · expires ${fmtDate(billing.planExpiresAt)}` : ""})
                  </span>
                ) : billing.planFreeGranted ? (
                  <span className="ml-1.5 text-xs text-muted-foreground">(admin-granted)</span>
                ) : (
                  <span className="ml-1.5 text-xs text-amber-600 dark:text-amber-400">
                    (never subscribed — trial banner applies after 14 days)
                  </span>
                )}
              </p>
            </div>
            {billing.planFreeGranted ? (
              <Button
                variant="outline"
                size="sm"
                disabled={revokingFree}
                onClick={revokeFree}
              >
                {revokingFree ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <XCircle className="size-3.5" />
                )}
                Revoke Free Forever
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={makingFree}
                onClick={makePlanFree}
              >
                {makingFree ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                Make plan Free Forever
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3.5">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Wallet balance</p>
              <p className="text-sm font-medium text-foreground">
                ₹{billing.walletBalance.toFixed(2)}
              </p>
            </div>
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="wallet-balance-input" className="text-xs text-muted-foreground">
                  Set new balance (₹)
                </Label>
                <Input
                  id="wallet-balance-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={walletInput}
                  onChange={(e) => setWalletInput(e.target.value)}
                  className="h-8 w-36"
                />
              </div>
              <Button size="sm" disabled={savingWallet} onClick={saveWalletBalance}>
                {savingWallet ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Wallet className="size-3.5" />
                )}
                Save
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            This is wacrm&apos;s own usage ledger — it does not pay Meta. Each WhatsApp Business
            Account still needs its own payment method in Meta Business Manager for Meta&apos;s
            own conversation charges.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>WhatsApp connection</CardTitle>
        </CardHeader>
        <CardContent>
          {whatsapp.configured ? (
            whatsapp.connected ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                <Wifi className="size-4" /> Connected
                {whatsapp.connectedAt ? ` since ${fmtDate(whatsapp.connectedAt)}` : ""}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <WifiOff className="size-4" /> Configured but not currently connected
              </span>
            )
          ) : (
            <span className="text-sm text-muted-foreground">No WhatsApp number configured yet.</span>
          )}

          {whatsappAlerts.length > 0 && (
            <div className="mt-4 space-y-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
                  <div>
                    <p className="text-sm font-medium text-red-700 dark:text-red-300">
                      {whatsappAlerts.length} flagged account-level event
                      {whatsappAlerts.length > 1 ? "s" : ""} — the account owner sees a
                      warning until this is resolved.
                    </p>
                    <ul className="mt-1.5 space-y-1 text-xs text-red-700/90 dark:text-red-300/90">
                      {whatsappAlerts.map((a) => {
                        const eventType =
                          a.rawValue && typeof a.rawValue === "object" && "event" in a.rawValue
                            ? String((a.rawValue as { event?: unknown }).event)
                            : null;
                        return (
                          <li key={a.id}>
                            {fmtDate(a.createdAt)} — {a.field}
                            {eventType ? ` (${eventType})` : ""}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resolveWhatsappAlerts}
                  disabled={resolvingAlerts}
                  className="shrink-0 border-red-500/40 bg-transparent text-red-700 hover:bg-red-500/20 dark:text-red-300"
                >
                  {resolvingAlerts ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                  Mark resolved
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members ({members.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell className="font-medium text-foreground">
                    {m.full_name || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.email || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {m.account_role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {fmtDate(m.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={confirmSuspend} onOpenChange={setConfirmSuspend}>
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              Suspend {organization.name}?
            </DialogTitle>
            <DialogDescription>
              Every member of this organization will immediately lose access to the CRM —
              their data is kept, nothing is deleted. Reinstate at any time from this page.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmSuspend(false)}
              disabled={statusUpdating}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => updateStatus("suspended")}
              disabled={statusUpdating}
            >
              {statusUpdating ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
              Suspend organization
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmImpersonate} onOpenChange={setConfirmImpersonate}>
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              Log in as {owner?.full_name || owner?.email || "the owner"}?
            </DialogTitle>
            <DialogDescription>
              You&apos;ll see the CRM exactly as {organization.name}&apos;s owner does. This is
              logged for audit, and a banner will let you return to your own account at any
              time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmImpersonate(false)}
              disabled={impersonating}
            >
              Cancel
            </Button>
            <Button onClick={startImpersonation} disabled={impersonating}>
              {impersonating ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
              Log in as client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmText("");
          setConfirmDelete(open);
        }}
      >
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              Delete {organization.name} permanently?
            </DialogTitle>
            <DialogDescription>
              This deletes every contact, conversation, message, broadcast, template, and
              wallet/invoice record this organization has, and permanently deletes every
              member&apos;s login. <strong>This cannot be undone.</strong> Type the organization
              name below to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-delete-name">
              Type <strong>{organization.name}</strong> to confirm
            </Label>
            <Input
              id="confirm-delete-name"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || deleteConfirmText !== organization.name}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular-nums text-foreground">{value}</p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
