"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  Ban,
  CheckCircle2,
  Loader2,
  LogIn,
  MessagesSquare,
  Radio,
  Users,
  Wifi,
  WifiOff,
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

interface OrgDetail {
  organization: {
    id: string;
    name: string;
    status: "active" | "suspended";
    createdAt: string;
    defaultCurrency: string;
  };
  members: Member[];
  whatsapp: { configured: boolean; connected: boolean; connectedAt: string | null };
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

  const [data, setData] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [confirmImpersonate, setConfirmImpersonate] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [impersonating, setImpersonating] = useState(false);

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

  const { organization, members, whatsapp, usage } = data;
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
      </div>

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
