"use client";

import { useEffect, useState } from "react";
import {
  BadgeCheck,
  Gauge,
  Loader2,
  MessageSquare,
  Send,
  ShieldAlert,
  Signal,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AccountOverview } from "@/lib/enterprise/queries";

function StatTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function HealthBadge({ health }: { health: AccountOverview["whatsapp"]["health"] }) {
  if (health === "healthy") {
    return (
      <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
        <Wifi className="size-3" /> Healthy
      </Badge>
    );
  }
  if (health === "action_needed") {
    return (
      <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300">
        <Signal className="size-3" /> Needs attention
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <WifiOff className="size-3" /> Disconnected
    </Badge>
  );
}

export default function CampaignIntelligenceOverviewPage() {
  const [data, setData] = useState<AccountOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/enterprise/overview")
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setData(json.overview ?? null);
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

  if (notEnabled || !data) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Overview isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>WhatsApp Account</span>
            <HealthBadge health={data.whatsapp.health} />
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Display Name</p>
            <p className="text-sm font-medium text-foreground">
              {data.whatsapp.displayName ?? data.whatsapp.businessName ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Phone Verification</p>
            <p className="text-sm font-medium text-foreground">
              {data.whatsapp.phoneVerificationStatus ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Messaging Tier</p>
            <p className="text-sm font-medium text-foreground">
              {data.whatsapp.messagingLimitTier ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Quality Rating</p>
            <p className="text-sm font-medium text-foreground">
              {data.whatsapp.qualityRating ?? "—"}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Messages Today" value={data.messagesToday.toLocaleString()} icon={MessageSquare} />
        <StatTile label="Delivery Rate" value={`${data.broadcastPerformance.deliveryRate}%`} icon={Send} />
        <StatTile label="Read Rate" value={`${data.broadcastPerformance.readRate}%`} icon={BadgeCheck} />
        <StatTile label="Reply Rate" value={`${data.broadcastPerformance.replyRate}%`} icon={MessageSquare} />
        <StatTile label="Failure Rate" value={`${data.broadcastPerformance.failureRate}%`} icon={ShieldAlert} />
      </div>
      <p className="text-xs text-muted-foreground">
        Delivery/read/reply/failure rates are computed from your broadcast
        campaigns — WhatsApp doesn&apos;t expose delivery tracking for
        individual conversation messages.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4 text-primary" /> Health Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <p className="text-3xl font-bold text-foreground">{data.healthScore}</p>
            <div className="h-2 flex-1 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-primary transition-all"
                style={{ width: `${data.healthScore}%` }}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Computed from your quality rating, connection health, and
            broadcast delivery performance — not a score Meta provides.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
