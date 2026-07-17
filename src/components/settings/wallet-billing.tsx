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
import { Loader2, Wallet, IndianRupee, Download } from 'lucide-react';

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
import { gstAmount, totalWithGst } from '@/lib/billing/rates';

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
  gst_amount: number;
  total_paid: number | null;
  created_at: string;
}

interface WalletData {
  balance: number;
  minRechargeAmount: number;
  gstRate: number;
  rates: Record<string, number>;
  transactions: WalletTransaction[];
}

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_type: 'wallet_recharge' | 'subscription';
  description: string;
  base_amount: number;
  gst_amount: number;
  total_amount: number;
  issued_at: string;
}

type PlanType = 'none' | 'managed' | 'self_serve_monthly' | 'self_serve_quarterly';
type PlanStatus = 'inactive' | 'active' | 'cancelled';

type MonthlyTier = 'basic' | 'pro' | null;
type SelfServePlan = 'monthly' | 'monthly_pro' | 'quarterly';

interface PlanData {
  planType: PlanType;
  planStatus: PlanStatus;
  planExpiresAt: string | null;
  managedRenewalsUsed: number;
  managedRenewalsMax: number;
  monthlyAmount: number;
  monthlyProAmount: number;
  quarterlyAmount: number;
  monthlyTier: MonthlyTier;
}

const CATEGORY_LABEL: Record<string, string> = {
  marketing: 'Marketing',
  utility: 'Utility',
  authentication: 'Authentication',
  service: 'Service',
};

const PLAN_STATUS_BADGE: Record<PlanStatus, { label: string; variant: 'default' | 'outline' | 'destructive' }> = {
  active: { label: 'Active', variant: 'default' },
  inactive: { label: 'Payment pending', variant: 'outline' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
};

function formatInr(amount: number): string {
  return `₹${amount.toFixed(2)}`;
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

export function WalletBilling() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [rechargeOpen, setRechargeOpen] = useState(searchParams.get('recharge') === '1');
  const [amount, setAmount] = useState('1500');
  const [paying, setPaying] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);

  const [plan, setPlan] = useState<PlanData | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [subscribing, setSubscribing] = useState<SelfServePlan | null>(null);
  const [choosingPlan, setChoosingPlan] = useState(false);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);

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

  const loadPlan = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/plan', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setPlan(json);
    } finally {
      setPlanLoading(false);
    }
  }, []);

  const loadInvoices = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/invoices', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setInvoices(json.invoices ?? []);
    } finally {
      setInvoicesLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadPlan();
    void loadInvoices();
  }, [load, loadPlan, loadInvoices]);

  const handleSubscribe = useCallback(
    async (selected: SelfServePlan) => {
      if (!sdkReady || !window.Razorpay) {
        toast.error('Payment SDK is still loading — try again in a moment');
        return;
      }
      setSubscribing(selected);
      try {
        const res = await fetch('/api/billing/subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: selected }),
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error || 'Failed to start subscription');
          setSubscribing(null);
          return;
        }

        const razorpay = new window.Razorpay({
          key: json.keyId,
          subscription_id: json.subscriptionId,
          name: 'Growth Saints CRM',
          description:
            selected === 'monthly'
              ? 'Self-serve Monthly plan'
              : selected === 'monthly_pro'
                ? 'Self-serve Monthly Pro plan'
                : 'Self-serve Quarterly plan',
          handler: () => {
            toast.success('Subscription started — it will show as Active once payment is confirmed.');
            void loadPlan();
            setSubscribing(null);
            setChoosingPlan(false);
          },
          modal: {
            ondismiss: () => setSubscribing(null),
          },
        });
        razorpay.open();
      } catch {
        toast.error('Failed to start subscription');
        setSubscribing(null);
      }
    },
    [sdkReady, loadPlan],
  );

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
            body: JSON.stringify(response),
          });
          const verifyJson = await verifyRes.json();
          if (verifyRes.ok) {
            toast.success('Wallet recharged successfully');
            setRechargeOpen(false);
            void load();
            void loadInvoices();
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
  }, [amount, data?.minRechargeAmount, sdkReady, load, loadInvoices]);

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

      {!planLoading && plan && (
        <Card className="border-border bg-card">
          <CardContent className="space-y-4 py-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-foreground">Your plan</h3>
                <p className="text-xs text-muted-foreground">
                  {plan.planType === 'managed' && 'Managed — provisioned by Growth Saints'}
                  {plan.planType === 'self_serve_monthly' &&
                    `Self-serve Monthly${plan.monthlyTier === 'pro' ? ' Pro' : ''} — ${formatInr(plan.monthlyTier === 'pro' ? plan.monthlyProAmount : plan.monthlyAmount)}/month`}
                  {plan.planType === 'self_serve_quarterly' && `Self-serve Quarterly — ${formatInr(plan.quarterlyAmount)}/quarter (${formatInr(plan.quarterlyAmount / 3)}/mo)`}
                  {plan.planType === 'none' && 'No plan yet — choose one below'}
                </p>
              </div>
              {plan.planType !== 'none' && (
                <Badge variant={PLAN_STATUS_BADGE[plan.planStatus].variant}>
                  {PLAN_STATUS_BADGE[plan.planStatus].label}
                </Badge>
              )}
            </div>

            {plan.planType === 'managed' && (
              <div className="grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Term ends</p>
                  <p className="font-medium text-foreground">{formatDate(plan.planExpiresAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Re-provisioning attempts used</p>
                  <p className="font-medium text-foreground">
                    {plan.managedRenewalsUsed} of {plan.managedRenewalsMax}
                  </p>
                </div>
              </div>
            )}

            {(plan.planType === 'self_serve_monthly' || plan.planType === 'self_serve_quarterly') && (
              <div className="border-t border-border pt-4 text-sm">
                <p className="text-xs text-muted-foreground">
                  {plan.planStatus === 'active' ? 'Renews on' : 'Expected renewal'}
                </p>
                <p className="font-medium text-foreground">{formatDate(plan.planExpiresAt)}</p>
                {plan.planStatus !== 'active' && !choosingPlan && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button
                      size="sm"
                      disabled={subscribing !== null || !sdkReady}
                      onClick={() =>
                        handleSubscribe(
                          plan.planType === 'self_serve_monthly'
                            ? plan.monthlyTier === 'pro'
                              ? 'monthly_pro'
                              : 'monthly'
                            : 'quarterly',
                        )
                      }
                    >
                      {subscribing ? <Loader2 className="size-4 animate-spin" /> : null}
                      Complete payment
                    </Button>
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline"
                      onClick={() => setChoosingPlan(true)}
                    >
                      Choose a different plan
                    </button>
                  </div>
                )}
              </div>
            )}

            {(plan.planType === 'none' || choosingPlan) && (
              <div className="border-t border-border pt-4">
                {choosingPlan && (
                  <button
                    type="button"
                    className="mb-3 text-xs font-medium text-muted-foreground hover:underline"
                    onClick={() => setChoosingPlan(false)}
                  >
                    ← Back
                  </button>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm font-semibold text-foreground">Monthly</p>
                    <p className="text-lg font-semibold text-foreground">{formatInr(plan.monthlyAmount)}<span className="text-xs font-normal text-muted-foreground">/month</span></p>
                    <Button
                      className="mt-3 w-full"
                      size="sm"
                      disabled={subscribing !== null || !sdkReady}
                      onClick={() => handleSubscribe('monthly')}
                    >
                      {subscribing === 'monthly' ? <Loader2 className="size-4 animate-spin" /> : null}
                      Subscribe
                    </Button>
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm font-semibold text-foreground">Monthly Pro</p>
                    <p className="text-lg font-semibold text-foreground">{formatInr(plan.monthlyProAmount)}<span className="text-xs font-normal text-muted-foreground">/month</span></p>
                    <Button
                      className="mt-3 w-full"
                      size="sm"
                      disabled={subscribing !== null || !sdkReady}
                      onClick={() => handleSubscribe('monthly_pro')}
                    >
                      {subscribing === 'monthly_pro' ? <Loader2 className="size-4 animate-spin" /> : null}
                      Subscribe
                    </Button>
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm font-semibold text-foreground">Quarterly</p>
                    <p className="text-lg font-semibold text-foreground">{formatInr(plan.quarterlyAmount)}<span className="text-xs font-normal text-muted-foreground">/quarter ({formatInr(plan.quarterlyAmount / 3)}/mo)</span></p>
                    <Button
                      className="mt-3 w-full"
                      size="sm"
                      disabled={subscribing !== null || !sdkReady}
                      onClick={() => handleSubscribe('quarterly')}
                    >
                      {subscribing === 'quarterly' ? <Loader2 className="size-4 animate-spin" /> : null}
                      Subscribe
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
                  <div className="text-right">
                    <span className={tx.amount >= 0 ? 'text-emerald-600' : 'text-foreground'}>
                      {tx.amount >= 0 ? '+' : ''}
                      {formatInr(tx.amount)}
                    </span>
                    {tx.type === 'recharge' && tx.gst_amount > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        incl. {formatInr(tx.gst_amount)} GST — paid {formatInr(tx.total_paid ?? tx.amount + tx.gst_amount)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardContent className="py-6">
          <h3 className="mb-3 text-sm font-medium text-foreground">Invoices</h3>
          {invoicesLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <div className="space-y-2">
              {invoices.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0"
                >
                  <div>
                    <p className="font-medium text-foreground">{inv.invoice_number}</p>
                    <p className="text-xs text-muted-foreground">
                      {inv.description} · {new Date(inv.issued_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">{formatInr(inv.total_amount)}</span>
                    <a
                      href={`/api/billing/invoices/${inv.id}/pdf`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      <Download className="size-3.5" />
                      PDF
                    </a>
                  </div>
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
              Minimum recharge amount is {formatInr(data?.minRechargeAmount ?? 1500)}. 18% GST is added at checkout.
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
          {Number.isFinite(Number(amount)) && Number(amount) > 0 && (
            <div className="space-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Wallet credit</span>
                <span>{formatInr(Number(amount))}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>GST ({((data?.gstRate ?? 0.18) * 100).toFixed(0)}%)</span>
                <span>{formatInr(gstAmount(Number(amount)))}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1 font-medium text-foreground">
                <span>Total payable</span>
                <span>{formatInr(totalWithGst(Number(amount)))}</span>
              </div>
            </div>
          )}
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
