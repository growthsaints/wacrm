'use client';

// ============================================================
// Dashboard → wallet balance widget (admin+ only).
//
// AiSensy-style layout: current plan status, a "Free Service
// Conversation" indicator (service messages never cost anything in
// our model, so this is always unlimited), and the WhatsApp
// Conversation Credits balance with a one-click "Buy More" shortcut
// into the recharge dialog on Settings → Billing.
// ============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type PlanType = 'none' | 'managed' | 'self_serve_monthly' | 'self_serve_quarterly';
type PlanStatus = 'inactive' | 'active' | 'cancelled';

const PLAN_LABEL: Record<PlanType, string> = {
  none: 'No plan',
  managed: 'Managed',
  self_serve_monthly: 'Self-serve Monthly',
  self_serve_quarterly: 'Self-serve Quarterly',
};

const PLAN_STATUS_BADGE: Record<PlanStatus, { label: string; variant: 'default' | 'outline' | 'destructive' }> = {
  active: { label: 'Active', variant: 'default' },
  inactive: { label: 'Payment pending', variant: 'outline' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
};

export function WalletBalanceCard() {
  const { canEditSettings } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [planType, setPlanType] = useState<PlanType | null>(null);
  const [planStatus, setPlanStatus] = useState<PlanStatus | null>(null);

  useEffect(() => {
    if (!canEditSettings) return;
    let cancelled = false;
    fetch('/api/billing/wallet', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setBalance(data.balance);
      })
      .catch(() => {});
    fetch('/api/billing/plan', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setPlanType(data.planType);
          setPlanStatus(data.planStatus);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canEditSettings]);

  if (!canEditSettings) return null;

  return (
    <div className="w-full space-y-3 rounded-xl border border-border bg-card p-4 sm:w-80">
      {planType && planStatus && (
        <Link
          href="/settings?tab=billing"
          className="flex items-center justify-between gap-3 border-b border-border pb-3 hover:opacity-80"
        >
          <span className="text-xs text-muted-foreground">{PLAN_LABEL[planType]}</span>
          {planType !== 'none' && (
            <Badge variant={PLAN_STATUS_BADGE[planStatus].variant}>
              {PLAN_STATUS_BADGE[planStatus].label}
            </Badge>
          )}
          {planType === 'none' && (
            <span className="text-xs font-medium text-primary">Choose a plan</span>
          )}
        </Link>
      )}

      <div>
        <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
          Free Service Conversation
        </p>
        <div className="mt-2 h-1.5 w-full rounded-full bg-emerald-100 dark:bg-emerald-950">
          <div className="h-1.5 w-full rounded-full bg-emerald-500" />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>0</span>
          <span>Unlimited</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <div>
          <p className="text-xs text-muted-foreground">WhatsApp Conversation Credits</p>
          <p className="text-lg font-semibold text-foreground">
            {balance === null ? '—' : `₹${balance.toFixed(2)}`}
          </p>
        </div>
        <Link
          href="/settings?tab=billing&recharge=1"
          className={buttonVariants({ size: 'sm' })}
        >
          Buy More
        </Link>
      </div>
    </div>
  );
}
