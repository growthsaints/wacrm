"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";

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

interface PlatformAdmin {
  userId: string;
  createdAt: string;
  fullName: string | null;
  email: string | null;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function PlatformSettingsPage() {
  const [admins, setAdmins] = useState<PlatformAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/platform/admins", { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || "Failed to load platform admins");
        return;
      }
      setAdmins(payload.admins ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd() {
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error("Email is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/platform/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || "Failed to add platform admin");
        return;
      }
      toast.success(`${trimmed} is now a platform admin`);
      setEmail("");
      setAddOpen(false);
      void load();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(admin: PlatformAdmin) {
    setRemoving(admin.userId);
    try {
      const res = await fetch(`/api/platform/admins/${admin.userId}`, {
        method: "DELETE",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || "Failed to remove platform admin");
        return;
      }
      toast.success(`Removed ${admin.email ?? admin.fullName ?? "admin"}`);
      setAdmins((prev) => prev.filter((a) => a.userId !== admin.userId));
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Platform settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage who has Super Admin access to every organization on Growth Saints CRM.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Platform admins</CardTitle>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Add admin
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : admins.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No platform admins found.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {admins.map((admin) => (
                <li
                  key={admin.userId}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <ShieldCheck className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {admin.fullName || admin.email || admin.userId}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {admin.email ?? ""} · Admin since {fmtDate(admin.createdAt)}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={removing === admin.userId}
                    onClick={() => handleRemove(admin)}
                    className="shrink-0 border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20 hover:text-red-200"
                  >
                    {removing === admin.userId ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!open) setEmail("");
          setAddOpen(open);
        }}
      >
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Add a platform admin</DialogTitle>
            <DialogDescription>
              Grant Super Admin access to an existing Growth Saints user by email. They must
              already have an account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="platform-admin-email">Email</Label>
            <Input
              id="platform-admin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@growthsaints.com"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEmail("");
                setAddOpen(false);
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add admin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
