'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Signal, Wifi, WifiOff } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { computeHealthStatus, type WhatsAppHealthStatus } from '@/lib/whatsapp/embedded-signup';
import type { WhatsAppConfig } from '@/types';

function HealthBadge({ status }: { status: WhatsAppHealthStatus }) {
  if (status === 'healthy') {
    return (
      <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
        <CheckCircle2 className="size-3" /> Connected
      </Badge>
    );
  }
  if (status === 'action_needed') {
    return (
      <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300">
        <Signal className="size-3" /> Needs attention
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <WifiOff className="size-3" /> Not connected
    </Badge>
  );
}

/**
 * Dashboard-top summary of the account's connected WhatsApp number —
 * business name, number, and a wa.me link, mirroring what AiSensy-style
 * dashboards surface up front. Reads the same `whatsapp_config` row
 * Settings > WhatsApp does (RLS lets any account member select it), so
 * this needs no new API route.
 */
export function WhatsAppStatusCard() {
  const [config, setConfig] = useState<WhatsAppConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('account_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!profile?.account_id) return;
      const { data } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('account_id', profile.account_id)
        .maybeSingle();
      if (!cancelled) {
        setConfig((data as WhatsAppConfig) ?? null);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="h-[86px] w-full max-w-xs animate-pulse rounded-xl border border-border bg-card" />
    );
  }

  if (!config) return null;

  const health = computeHealthStatus({
    hasConfig: true,
    registeredAt: config.registered_at ?? null,
    qualityRating: config.quality_rating ?? null,
    lastRegistrationError: config.last_registration_error ?? null,
  });

  const number = config.display_phone_number?.replace(/[^\d]/g, '');

  return (
    <div className="w-full max-w-xs rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Wifi className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {config.business_name || config.display_name || 'WhatsApp number'}
            </p>
            {number ? (
              <a
                href={`https://wa.me/${number}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:text-primary/80"
              >
                {config.display_phone_number}
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">—</p>
            )}
          </div>
        </div>
        <HealthBadge status={health} />
      </div>
    </div>
  );
}
