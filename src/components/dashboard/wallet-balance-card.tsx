'use client';

// ============================================================
// Dashboard → wallet balance widget (admin+ only).
//
// A compact, always-visible balance + recharge shortcut — the actual
// recharge flow (Razorpay Checkout) lives on Settings → Billing; this
// just surfaces the number where an admin already looks every day,
// the same way AiSensy/Interakt-style WhatsApp CRMs do.
// ============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Wallet, ChevronRight } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

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
    <Link
      href="/settings?tab=billing"
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted sm:w-64"
    >
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
        <Wallet className="size-4 text-primary" />
      </div>
      <div className="flex-1">
        <p className="text-xs text-muted-foreground">Wallet balance</p>
        <p className="text-sm font-semibold text-foreground">
          {balance === null ? '—' : `₹${balance.toFixed(2)}`}
        </p>
      </div>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  );
}
