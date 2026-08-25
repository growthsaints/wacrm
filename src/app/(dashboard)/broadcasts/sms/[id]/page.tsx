'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { ArrowLeft, CheckCircle2, Loader2, MessageSquare, RefreshCw, XCircle } from 'lucide-react';
import { useSmsBroadcast } from '@/hooks/use-sms-broadcast';
import { toast } from 'sonner';

interface SmsBroadcastRow {
  id: string;
  name: string;
  body_text: string;
  status: 'sending' | 'sent' | 'failed';
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
}

interface SmsRecipientRow {
  id: string;
  status: 'pending' | 'sent' | 'failed';
  error_message: string | null;
  sent_at: string | null;
  contact: { name: string | null; phone: string } | null;
}

const STATUS_STYLES: Record<string, string> = {
  sending: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  sent: 'bg-primary/10 text-primary border-primary/20',
  failed: 'bg-red-500/10 text-red-400 border-red-500/20',
  pending: 'bg-slate-500/10 text-muted-foreground border-slate-500/20',
};

export default function SmsBroadcastDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const broadcastId = params.id as string;

  const [broadcast, setBroadcast] = useState<SmsBroadcastRow | null>(null);
  const [recipients, setRecipients] = useState<SmsRecipientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { retryFailedSmsBroadcast, isProcessing } = useSmsBroadcast();

  const fetchData = useCallback(async () => {
    const supabase = createClient();
    const [{ data: b }, { data: r }] = await Promise.all([
      supabase.from('sms_broadcasts').select('*').eq('id', broadcastId).maybeSingle(),
      supabase
        .from('sms_broadcast_recipients')
        .select('id, status, error_message, sent_at, contact:contacts(name, phone)')
        .eq('sms_broadcast_id', broadcastId)
        .order('created_at', { ascending: true }),
    ]);
    setBroadcast(b as SmsBroadcastRow | null);
    setRecipients((r ?? []) as unknown as SmsRecipientRow[]);
    setLoading(false);
  }, [broadcastId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount, same pattern used elsewhere (broadcasts/[id]/page.tsx)
    fetchData();
  }, [fetchData]);

  async function handleRetryFailed() {
    if (!broadcast) return;
    try {
      await retryFailedSmsBroadcast(broadcast.id);
      toast.success('Retry complete');
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Retry failed');
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!broadcast) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">SMS broadcast not found</p>
        <Button variant="outline" onClick={() => router.push('/broadcasts')}>
          Back to Broadcasts
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => router.push('/broadcasts')} className="border-border">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
                <MessageSquare className="h-5 w-5 text-primary" />
                {broadcast.name}
              </h1>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[broadcast.status]}`}>
                {broadcast.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{new Date(broadcast.created_at).toLocaleString()}</p>
          </div>
        </div>
        {broadcast.failed_count > 0 && (
          <Button onClick={handleRetryFailed} disabled={isProcessing} className="gap-2">
            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Retry Failed ({broadcast.failed_count})
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-xl font-semibold text-foreground">{broadcast.total_recipients}</p>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <p className="text-xs text-muted-foreground">Sent</p>
          <p className="text-xl font-semibold text-primary">{broadcast.sent_count}</p>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <p className="text-xs text-muted-foreground">Failed</p>
          <p className="text-xl font-semibold text-red-400">{broadcast.failed_count}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card/50 p-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Message</p>
        <p className="whitespace-pre-wrap text-sm text-foreground">{broadcast.body_text}</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Contact</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {recipients.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 text-foreground">
                  {r.contact?.name || r.contact?.phone || 'Unknown'}
                </td>
                <td className="px-4 py-2">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status]}`}>
                    {r.status === 'sent' && <CheckCircle2 className="h-3 w-3" />}
                    {r.status === 'failed' && <XCircle className="h-3 w-3" />}
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{r.error_message || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
