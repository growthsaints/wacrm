"use client";

import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RotateCcw, Copy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { BUSINESS_WORKSPACE_FEATURES, type BusinessWorkspaceFeature } from "@/lib/business-workspace/features";

const FEATURE_LABELS: Record<BusinessWorkspaceFeature, string> = {
  customer_hub: "Customer Hub",
  customer_360: "Customer 360",
  shared_inbox: "Shared Inbox",
  team_workspace: "Team Workspace",
  ai_assistant: "AI Assistant",
  labels: "Labels",
  notes: "Notes",
  followup_center: "Follow-up Center",
  calendar: "Calendar",
  deals: "Deals",
  campaign_planner: "Campaign Planner",
  analytics: "Analytics",
  reports: "Reports",
};

const ACCESS_TYPES = [
  { value: "none", label: "None" },
  { value: "permanent", label: "Permanent" },
  { value: "trial", label: "Trial" },
  { value: "beta", label: "Beta" },
  { value: "vip", label: "VIP" },
  { value: "internal_team", label: "Internal Team" },
  { value: "partner", label: "Partner" },
  { value: "free", label: "Free" },
];

interface License {
  workspace_enabled: boolean;
  access_type: string;
  start_date: string | null;
  expiry_date: string | null;
  reason: string | null;
  notes_admin: string | null;
  [key: string]: unknown;
}

interface AuditEntry {
  id: string;
  feature: string;
  previous_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  ip_address: string | null;
  reason: string | null;
  created_at: string;
}

function toDateInput(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export default function TenantBusinessWorkspaceDetailPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = use(params);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workspaceEnabled, setWorkspaceEnabled] = useState(false);
  const [features, setFeatures] = useState<Record<BusinessWorkspaceFeature, boolean>>(
    Object.fromEntries(BUSINESS_WORKSPACE_FEATURES.map((f) => [f, false])) as Record<BusinessWorkspaceFeature, boolean>,
  );
  const [accessType, setAccessType] = useState("none");
  const [startDate, setStartDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [cloneFrom, setCloneFrom] = useState("");

  function applyLicense(license: License | null) {
    setWorkspaceEnabled(license?.workspace_enabled ?? false);
    setFeatures(
      Object.fromEntries(
        BUSINESS_WORKSPACE_FEATURES.map((f) => [f, Boolean(license?.[f])]),
      ) as Record<BusinessWorkspaceFeature, boolean>,
    );
    setAccessType(license?.access_type ?? "none");
    setStartDate(toDateInput(license?.start_date ?? null));
    setExpiryDate(toDateInput(license?.expiry_date ?? null));
    setReason(license?.reason ?? "");
    setNotes(license?.notes_admin ?? "");
  }

  function loadAll() {
    setLoading(true);
    Promise.all([
      fetch(`/api/platform/business-workspace/${accountId}`).then((r) => r.json()),
      fetch(`/api/platform/business-workspace/${accountId}/audit-log`).then((r) => r.json()),
    ])
      .then(([licenseData, auditData]) => {
        applyLicense(licenseData.license);
        setAuditLog(auditData.entries ?? []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/business-workspace/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceEnabled,
          ...features,
          accessType,
          startDate: startDate || null,
          expiryDate: expiryDate || null,
          reason: reason || null,
          notes: notes || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Failed to save.");
        return;
      }
      toast.success("Business Workspace configuration saved.");
      loadAll();
    } catch {
      toast.error("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/business-workspace/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceEnabled: false,
          ...Object.fromEntries(BUSINESS_WORKSPACE_FEATURES.map((f) => [f, false])),
          accessType: "none",
          startDate: null,
          expiryDate: null,
          reason: "Configuration reset",
          notes: null,
        }),
      });
      if (!res.ok) {
        toast.error("Failed to reset.");
        return;
      }
      toast.success("Configuration reset.");
      loadAll();
    } finally {
      setSaving(false);
    }
  }

  async function handleClone() {
    if (!cloneFrom.trim()) {
      toast.error("Enter a source account ID to clone from.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/business-workspace/${accountId}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceAccountId: cloneFrom.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Failed to clone configuration.");
        return;
      }
      toast.success("Configuration cloned.");
      loadAll();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">Business Workspace Configuration</h1>
        <Button variant="outline" onClick={handleReset} disabled={saving}>
          <RotateCcw className="size-4" /> Reset Configuration
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            Master Switch
            <Switch checked={workspaceEnabled} onCheckedChange={setWorkspaceEnabled} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            When off, every feature below is inert for this tenant regardless
            of its own toggle — the Business Workspace section disappears
            from their sidebar entirely.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Individual Features</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {BUSINESS_WORKSPACE_FEATURES.map((feature) => (
            <div
              key={feature}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"
            >
              <span className="text-sm text-foreground">{FEATURE_LABELS[feature]}</span>
              <Switch
                checked={features[feature]}
                onCheckedChange={(v) => setFeatures((prev) => ({ ...prev, [feature]: v }))}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Access Grant</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block">Access Type</Label>
            <Select value={accessType} onValueChange={(v) => setAccessType(v ?? "none")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCESS_TYPES.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div />
          <div>
            <Label className="mb-1.5 block">Start Date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 block">Expiry Date</Label>
            <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block">Reason</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this tenant getting this access?"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clone Configuration</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label className="mb-1.5 block">Source Account ID</Label>
            <Input
              value={cloneFrom}
              onChange={(e) => setCloneFrom(e.target.value)}
              placeholder="Copy master switch + feature toggles from this tenant"
            />
          </div>
          <Button variant="outline" onClick={handleClone} disabled={saving}>
            <Copy className="size-4" /> Apply Configuration
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          Save Changes
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit Log</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {auditLog.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No changes recorded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Feature</TableHead>
                  <TableHead>Previous</TableHead>
                  <TableHead>New</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLog.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium text-foreground">{entry.feature}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.previous_value ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{entry.new_value ?? "—"}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{entry.reason ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(entry.created_at).toLocaleString()}
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
