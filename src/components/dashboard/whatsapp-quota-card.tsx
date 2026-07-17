'use client';

// ============================================================
// WhatsAppQuotaCard — AiSensy-style status row on the dashboard:
// connection status, quality rating, and remaining daily broadcast
// quota as three pill tiles. Owner only — same visibility rule as the
// header's "used today" figure this supersedes (see
// src/components/dashboard/top-status-bar.tsx and
// src/lib/whatsapp/daily-quota.ts for the guard this number mirrors).
// ============================================================

import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { dailyCapForTier } from '@/lib/whatsapp/messaging-limit';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface ConfigRow {
  status?: string | null;
  quality_rating?: string | null;
  messaging_limit_tier?: string | null;
}

const QUALITY_LABEL: Record<string, string> = {
  GREEN: 'High',
  YELLOW: 'Medium',
  RED: 'Low',
};

const QUALITY_PILL_CLASS: Record<string, string> = {
  GREEN: 'bg-emerald-500 text-white',
  YELLOW: 'bg-amber-500 text-white',
  RED: 'bg-red-600 text-white',
};

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex text-muted-foreground hover:text-foreground">
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

function Tile({
  label,
  tip,
  children,
}: {
  label: string;
  tip: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        <InfoTip text={tip} />
      </span>
      {children}
    </div>
  );
}

export function WhatsAppQuotaCard() {
  const { isOwner, accountId } = useAuth();
  const [config, setConfig] = useState<ConfigRow | null>(null);
  const [usedToday, setUsedToday] = useState<number | null>(null);

  useEffect(() => {
    if (!isOwner || !accountId) return;
    let cancelled = false;
    const db = createClient();
    db.from('whatsapp_config')
      .select('status, quality_rating, messaging_limit_tier')
      .eq('account_id', accountId)
      .maybeSingle()
      .then(({ data }: { data: ConfigRow | null }) => {
        if (cancelled) return;
        setConfig(data);
        const cap = dailyCapForTier(data?.messaging_limit_tier);
        if (cap === null) return;
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        db.rpc('count_recent_business_initiated_contacts', {
          p_account_id: accountId,
          p_since: since,
        }).then(({ data: count, error }: { data: number | null; error: unknown }) => {
          if (!cancelled && !error) setUsedToday(count ?? 0);
        });
      });
    return () => {
      cancelled = true;
    };
  }, [isOwner, accountId]);

  if (!isOwner) return null;

  const connected = config?.status === 'connected';
  const qualityKey = config?.quality_rating && QUALITY_LABEL[config.quality_rating] ? config.quality_rating : null;
  const dailyCap = dailyCapForTier(config?.messaging_limit_tier);
  const remaining = dailyCap !== null && usedToday !== null ? Math.max(dailyCap - usedToday, 0) : null;

  return (
    <div className="flex flex-wrap gap-8 rounded-xl border border-border bg-card p-5">
      <Tile label="WhatsApp Business API Status" tip="Whether your WhatsApp number is connected and able to send messages.">
        <span
          className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold ${
            connected ? 'bg-emerald-500 text-white' : 'bg-red-600 text-white'
          }`}
        >
          {connected ? 'Connected' : 'Disabled'}
        </span>
      </Tile>

      <Tile label="Quality Rating" tip="Meta's assessment of your recent message quality — Low ratings risk your messaging limit being reduced.">
        <span
          className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold ${
            qualityKey ? QUALITY_PILL_CLASS[qualityKey] : 'bg-muted text-muted-foreground'
          }`}
        >
          {qualityKey ? QUALITY_LABEL[qualityKey] : 'Unknown'}
        </span>
      </Tile>

      <Tile label="Remaining Quota" tip="How many more contacts you can message today before hitting Meta's daily limit for your tier — broadcasts pause automatically once this hits 0.">
        <span className="text-2xl font-semibold text-foreground">
          {remaining === null ? '—' : remaining.toLocaleString()}
        </span>
      </Tile>
    </div>
  );
}
