'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Signal,
  Wifi,
  WifiOff,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { computeHealthStatus, describeEmbeddedSignupError, type WhatsAppHealthStatus } from '@/lib/whatsapp/embedded-signup';
import { dailyCapForTier, formatMessagingLimit } from '@/lib/whatsapp/messaging-limit';
import { createClient } from '@/lib/supabase/client';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';
import { ConnectWhatsAppButton } from './connect-whatsapp-button';

function fmtDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function HealthBadge({ status, t }: { status: WhatsAppHealthStatus; t: ReturnType<typeof useTranslations> }) {
  if (status === 'healthy') {
    return (
      <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
        <CheckCircle2 className="size-3" />
        {t('health.healthy')}
      </Badge>
    );
  }
  if (status === 'action_needed') {
    return (
      <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300">
        <Signal className="size-3" />
        {t('health.actionNeeded')}
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <WifiOff className="size-3" />
      {t('health.disconnected')}
    </Badge>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

/**
 * The client-facing WhatsApp Management panel: everything a business
 * owner needs (Connect / Disconnect / Reconnect / Sync templates /
 * Refresh status) with zero technical fields. No phone_number_id,
 * waba_id, business_id, or tokens are ever rendered here — those stay
 * in the (separately gated) Advanced setup form for self-hosters.
 */
export function WhatsAppManagement({
  config,
  accountId,
  onChanged,
}: {
  config: WhatsAppConfigType | null;
  accountId: string | null;
  onChanged: () => void;
}) {
  const t = useTranslations('Settings.whatsappManagement');
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [usedToday, setUsedToday] = useState<number | null>(null);

  const health = computeHealthStatus({
    hasConfig: !!config,
    registeredAt: config?.registered_at ?? null,
    qualityRating: config?.quality_rating ?? null,
    lastRegistrationError: config?.last_registration_error ?? null,
  });

  const dailyCap = dailyCapForTier(config?.messaging_limit_tier);

  // Live "used today" count for the daily-quota guard (see
  // src/lib/whatsapp/daily-quota.ts, which enforces the same number
  // at broadcast send time) — informational only, not editable here.
  useEffect(() => {
    if (!accountId || dailyCap === null) {
      setUsedToday(null);
      return;
    }
    let cancelled = false;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    createClient()
      .rpc('count_recent_business_initiated_contacts', { p_account_id: accountId, p_since: since })
      .then(({ data, error }: { data: number | null; error: unknown }) => {
        if (!cancelled && !error) setUsedToday(data ?? 0);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, dailyCap]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/whatsapp/config/refresh', { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('refreshFailed'));
        return;
      }
      toast.success(t('refreshSuccess'));
      onChanged();
    } catch {
      toast.error(t('refreshFailed'));
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSyncTemplates() {
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('syncTemplatesFailed'));
        return;
      }
      toast.success(t('syncTemplatesSuccess', { count: payload.total ?? 0 }));
    } catch {
      toast.error(t('syncTemplatesFailed'));
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/whatsapp/config', { method: 'DELETE' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('disconnectFailed'));
        return;
      }
      toast.success(t('disconnectSuccess'));
      setConfirmDisconnect(false);
      onChanged();
    } catch {
      toast.error(t('disconnectFailed'));
    } finally {
      setDisconnecting(false);
    }
  }

  if (!config) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Wifi className="size-5" />
        </span>
        <div>
          <h3 className="text-base font-semibold text-foreground">{t('connectTitle')}</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{t('connectDesc')}</p>
        </div>
        <ConnectWhatsAppButton onConnected={onChanged} />
      </div>
    );
  }

  const qualityKey = config.quality_rating && ['GREEN', 'YELLOW', 'RED'].includes(config.quality_rating)
    ? config.quality_rating
    : 'unknown';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Wifi className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {config.business_name || config.display_name || t('connectTitle')}
            </p>
            <p className="text-xs text-muted-foreground">{config.display_phone_number ?? '—'}</p>
          </div>
        </div>
        <HealthBadge status={health} t={t} />
      </div>

      {/* The connect flow's own toast explaining an action_needed state
          (e.g. a PIN mismatch) only shows once, right after the attempt,
          then vanishes — so anyone who navigates away and comes back
          just sees the "Action needed" badge with no idea why. This
          banner keeps the same explanation visible until it's resolved. */}
      {health === 'action_needed' && config.last_registration_error && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>{describeEmbeddedSignupError(config.last_registration_error)}</p>
        </div>
      )}

      <div className="divide-y divide-border rounded-lg border border-border px-4">
        <InfoRow label={t('businessName')} value={config.business_name ?? '—'} />
        <InfoRow label={t('displayName')} value={config.display_name ?? '—'} />
        <InfoRow label={t('phoneNumber')} value={config.display_phone_number ?? '—'} />
        <InfoRow
          label={t('connectionStatus')}
          value={
            config.status === 'connected' ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <Wifi className="size-3.5" /> {t('health.healthy')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <WifiOff className="size-3.5" /> {t('health.disconnected')}
              </span>
            )
          }
        />
        <InfoRow
          label={t('qualityRating')}
          value={t(`quality.${qualityKey}` as string)}
        />
        <InfoRow label={t('messagingLimit')} value={formatMessagingLimit(config.messaging_limit_tier)} />
        {dailyCap !== null && (
          <InfoRow
            label={t('usedToday')}
            value={usedToday === null ? '—' : `${usedToday.toLocaleString()} / ${dailyCap.toLocaleString()}`}
          />
        )}
        <InfoRow label={t('verifiedStatus')} value={config.code_verification_status ?? '—'} />
        <InfoRow label={t('lastSync')} value={fmtDateTime(config.last_synced_at) ?? t('never')} />
      </div>

      {(!config.messaging_limit_tier || config.messaging_limit_tier === 'TIER_250') && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          <p className="font-medium">Only 250 messages/day right now</p>
          <p className="mt-1 text-amber-700/90 dark:text-amber-300/90">
            Verify your business in Meta Business Suite (Business Settings → Security Center → Start
            Verification) to unlock 2,000/day — or send 2,000 delivered messages to unique customers
            outside a customer-service window within 30 days using high-quality templates. After 2,000,
            Meta scales your limit up automatically (10,000 → 100,000 → Unlimited) based on quality and
            usage.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {refreshing ? t('refreshing') : t('refreshStatus')}
        </Button>
        <Button variant="outline" onClick={handleSyncTemplates} disabled={syncing}>
          {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {syncing ? t('syncingTemplates') : t('syncTemplates')}
        </Button>
        {health === 'disconnected' || health === 'action_needed' ? (
          <ConnectWhatsAppButton onConnected={onChanged} />
        ) : null}
        <Button
          variant="outline"
          onClick={() => setConfirmDisconnect(true)}
          disabled={disconnecting}
          className="border-red-500/40 bg-red-500/10 text-red-500 hover:bg-red-500/20"
        >
          <Ban className="size-4" />
          {t('disconnect')}
        </Button>
      </div>

      <Dialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('disconnectConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('disconnectConfirmDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDisconnect(false)} disabled={disconnecting}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
              {t('disconnect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
