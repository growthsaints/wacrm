'use client';

// ============================================================
// Dashboard → wallet balance widget (admin+ only).
//
// AiSensy-style layout: a "Free Service Conversation" indicator
// (service messages never cost anything in our model, so this is
// always unlimited) plus the WhatsApp Conversation Credits balance
// with a one-click "Buy More" shortcut into the recharge dialog on
// Settings → Billing.
// ============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { buttonVariants } from '@/components/ui/button';

export function WalletBalanceCard() {
  const { canEditSettings } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!canEditSettings) return;
    let cancelled = false;
    fetch('/api/billing/wallet', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setBalance(data.balance);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canEditSettings]);

  if (!canEditSettings) return null;

  return (
    <div className="w-full space-y-3 rounded-xl border border-border bg-card p-4 sm:w-80">
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
