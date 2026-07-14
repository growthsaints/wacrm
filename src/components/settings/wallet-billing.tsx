'use client';

// ============================================================
// Settings → Billing — prepaid wallet for WhatsApp usage.
//
// Growth Saints CRM charges per WhatsApp template message sent, based
// on Meta's conversation-category pricing. Accounts prepay into a
// wallet via Razorpay; this panel shows the balance, lets an admin
// recharge (Razorpay Checkout), and lists recent transactions.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { toast } from 'sonner';
import { Loader2, Wallet, IndianRupee } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { SettingsPanelHead } from './settings-panel-head';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
    };
  }
}

interface WalletTransaction {
  id: string;
  type: 'recharge' | 'message_charge';
  amount: number;
  conversation_category: 'marketing' | 'utility' | 'authentication' | 'service' | null;
  balance_after: number;
  created_at: string;
}

interface WalletData {
  balance: number;
  minRechargeAmount: number;
  rates: Record<string, number>;
  transactions: WalletTransaction[];
}

const CATEGORY_LABEL: Record<string, string> = {
  marketing: 'Marketing',
  utility: 'Utility',
  authentication: 'Authentication',
  service: 'Service',
};

function formatInr(amount: number): string {
  return `₹${amount.toFixed(2)}`;
}

export function WalletBilling() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [rechargeOpen, setRechargeOpen] = useState(searchParams.get('recharge') === '1');
  const [amount, setAmount] = useState('1500');
  const [paying, setPaying] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/wallet', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setData(json);
      else toast.error(json.error || 'Failed to load wallet');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRecharge = useCallback(async () => {
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees < (data?.minRechargeAmount ?? 1500)) {
      toast.error(`Minimum recharge amount is ${formatInr(data?.minRechargeAmount ?? 1500)}`);
      return;
    }
    if (!sdkReady || !window.Razorpay) {
      toast.error('Payment SDK is still loading — try again in a moment');
      return;
    }

    setPaying(true);
    try {
      const orderRes = await fetch('/api/billing/recharge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: rupees }),
      });
      const order = await orderRes.json();
      if (!orderRes.ok) {
        toast.error(order.error || 'Failed to start payment');
        setPaying(false);
        return;
      }

      const razorpay = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'Growth Saints CRM',
        description: 'Wallet recharge',
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          const verifyRes = await fetch('/api/billing/recharge/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...response, amount: rupees }),
          });
          const verifyJson = await verifyRes.json();
          if (verifyRes.ok) {
            toast.success('Wallet recharged successfully');
            setRechargeOpen(false);
            void load();
          } else {
            toast.error(verifyJson.error || 'Payment verification failed');
          }
          setPaying(false);
        },
        modal: {
          ondismiss: () => setPaying(false),
        },
      });
      razorpay.open();
    } catch {
      toast.error('Failed to start payment');
      setPaying(false);
    }
  }, [amount, data?.minRechargeAmount, sdkReady, load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
        onLoad={() => setSdkReady(true)}
      />
      <SettingsPanelHead
        title="Billing"
        description="Recharge your wallet to send WhatsApp messages — charged per conversation category."
      />

      <Card className="border-border bg-card">
        <CardContent className="space-y-4 py-6">
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

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10">
                <Wallet className="size-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">WhatsApp Conversation Credits</p>
                <p className="text-2xl font-semibold text-foreground">
                  {formatInr(data?.balance ?? 0)}
                </p>
              </div>
            </div>
            <Button onClick={() => setRechargeOpen(true)}>
              <IndianRupee className="size-4" />
              Buy More
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardContent className="py-6">
          <h3 className="mb-3 text-sm font-medium text-foreground">Recent transactions</h3>
          {(data?.transactions.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            <div className="space-y-2">
              {data!.transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={tx.type === 'recharge' ? 'default' : 'outline'}>
                      {tx.type === 'recharge' ? 'Recharge' : CATEGORY_LABEL[tx.conversation_category ?? ''] ?? 'Charge'}
                    </Badge>
                    <span className="text-muted-foreground">
                      {new Date(tx.created_at).toLocaleString()}
                    </span>
                  </div>
                  <span className={tx.amount >= 0 ? 'text-emerald-600' : 'text-foreground'}>
                    {tx.amount >= 0 ? '+' : ''}
                    {formatInr(tx.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={rechargeOpen} onOpenChange={setRechargeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recharge wallet</DialogTitle>
            <DialogDescription>
              Minimum recharge amount is {formatInr(data?.minRechargeAmount ?? 1500)}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="recharge-amount">Amount (₹)</Label>
            <Input
              id="recharge-amount"
              type="number"
              min={data?.minRechargeAmount ?? 1500}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRechargeOpen(false)} disabled={paying}>
              Cancel
            </Button>
            <Button onClick={handleRecharge} disabled={paying || !sdkReady}>
              {paying ? <Loader2 className="size-4 animate-spin" /> : null}
              Pay with Razorpay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
