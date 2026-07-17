'use client';

// ============================================================
// TopStatusBar — AiSensy-style WhatsApp/plan status, centered in the
// header row between the page title and the theme toggle/avatar.
// Owner only — this is billing/plan info, which team members (admin
// included) shouldn't see per the same rule applied to the dashboard's
// quota card and wallet card.
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
    <div className="hidden items-center gap-6 whitespace-nowrap text-xs md:flex lg:gap-8 lg:text-sm">
      <div className="flex items-center gap-1.5">
        <span className="hidden text-muted-foreground lg:inline">WhatsApp Business API Status:</span>
        <span className="text-muted-foreground lg:hidden">WABA:</span>
        {connected ? (
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">CONNECTED</span>
        ) : (
          <>
            <span className="font-semibold text-red-600 dark:text-red-400">PENDING</span>
            <ConnectWhatsAppButton onConnected={() => setConnected(true)} label="Apply Now" size="sm" />
          </>
        )}
      </div>

      <div className="hidden items-center gap-1.5 lg:flex">
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
