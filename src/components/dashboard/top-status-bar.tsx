'use client';

// ============================================================
// TopStatusBar — AiSensy-style thin strip across the very top of the
// authenticated shell (every dashboard page), nudging an admin to
// connect WhatsApp and/or explore plans. Admin+ only — an agent/viewer
// can't act on either button, so there's nothing for them to do with
// it.
// ============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { buttonVariants } from '@/components/ui/button';
import { ConnectWhatsAppButton } from '@/components/whatsapp/connect-whatsapp-button';

type PlanType = 'none' | 'managed' | 'self_serve_monthly' | 'self_serve_quarterly';

const PLAN_LABEL: Record<PlanType, string> = {
  none: 'Free Forever',
  managed: 'Managed',
  self_serve_monthly: 'Self-serve Monthly',
  self_serve_quarterly: 'Self-serve Quarterly',
};

export function TopStatusBar() {
  const { canEditSettings, accountId } = useAuth();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [planType, setPlanType] = useState<PlanType | null>(null);

  useEffect(() => {
    if (!canEditSettings || !accountId) return;
    let cancelled = false;
    const db = createClient();
    db.from('whatsapp_config')
      .select('status')
      .eq('account_id', accountId)
      .maybeSingle()
      .then(({ data }: { data: { status?: string } | null }) => {
        if (!cancelled) setConnected(data ? data.status === 'connected' : false);
      });
    fetch('/api/billing/plan', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setPlanType(data.planType);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canEditSettings, accountId]);

  if (!canEditSettings || connected === null) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-2 border-b border-border bg-muted/40 px-4 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">WhatsApp Business API Status:</span>
        {connected ? (
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">CONNECTED</span>
        ) : (
          <>
            <span className="font-semibold text-red-600 dark:text-red-400">PENDING</span>
            <ConnectWhatsAppButton onConnected={() => setConnected(true)} label="Apply Now" size="sm" />
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Current Plan:</span>
        <span className="font-semibold text-foreground">
          {planType ? PLAN_LABEL[planType] : '—'}
        </span>
        <Link href="/settings?tab=billing" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
          Explore Plans
        </Link>
      </div>
    </div>
  );
}
