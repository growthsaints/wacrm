"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LifeBuoy, Loader2, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SUPPORT_WHATSAPP_URL } from "@/lib/support";
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
  whatsapp_personal_connect: "WhatsApp Personal Connect (QR)",
};

const ACCESS_TYPE_LABELS: Record<string, string> = {
  none: "None",
  permanent: "Permanent",
  trial: "Trial",
  beta: "Beta",
  vip: "VIP",
  internal_team: "Internal Team",
  partner: "Partner",
  free: "Free",
};

interface FeaturesResponse {
  enabled: boolean;
  features: Partial<Record<BusinessWorkspaceFeature, boolean>>;
  accessType: string | null;
  expiryDate: string | null;
}

interface WhatsAppStatus {
  status: "disconnected" | "connecting" | "qr_pending" | "connected";
  phoneNumber: string | null;
}

export default function BusinessWorkspaceSettingsPage() {
  const [data, setData] = useState<FeaturesResponse | null>(null);
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/business-workspace/features").then((r) => r.json()),
      fetch("/api/business-workspace/whatsapp-personal/status")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([featuresJson, waJson]) => {
        setData(featuresJson);
        setWaStatus(waJson);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!data || !data.enabled) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Business Workspace isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Plan</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <Badge className="mt-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
              Enabled
            </Badge>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Access Type</p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {data.accessType ? ACCESS_TYPE_LABELS[data.accessType] ?? data.accessType : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Expiry</p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {data.expiryDate ? new Date(data.expiryDate).toLocaleDateString() : "No expiry"}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Features</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {BUSINESS_WORKSPACE_FEATURES.map((feature) => {
            const on = Boolean(data.features[feature]);
            return (
              <div
                key={feature}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
              >
                <span className="text-sm text-foreground">{FEATURE_LABELS[feature]}</span>
                <Badge variant={on ? "default" : "outline"} className={on ? "" : "text-muted-foreground"}>
                  {on ? "Enabled" : "Disabled"}
                </Badge>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {data.features.whatsapp_personal_connect && waStatus && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Smartphone className="size-4 text-primary" /> WhatsApp Personal Connect
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-sm text-foreground">
              {waStatus.status === "connected"
                ? `Connected${waStatus.phoneNumber ? ` as +${waStatus.phoneNumber}` : ""}`
                : "Not connected"}
            </p>
            <Button variant="outline" size="sm" render={<Link href="/business-workspace/whatsapp-connect" />}>
              Manage
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LifeBuoy className="size-4 text-primary" /> Need a different plan or more features?
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Feature access and plan changes are managed by Growth Saints — reach out and we&apos;ll set it up.
          </p>
          <Button render={<a href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" />}>
            Contact Support
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
