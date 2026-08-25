'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, MessagesSquare, Plus } from 'lucide-react';

interface HttpSmsBroadcastRow {
  id: string;
  name: string;
  body_text: string;
  status: 'sending' | 'sent' | 'failed';
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  sending: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  sent: 'bg-primary/10 text-primary border-primary/20',
  failed: 'bg-red-500/10 text-red-400 border-red-500/20',
};

export default function HttpSmsBroadcastListPage() {
  const router = useRouter();
  const [broadcasts, setBroadcasts] = useState<HttpSmsBroadcastRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBroadcasts = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from('httpsms_broadcasts')
        .select('*')
        .order('created_at', { ascending: false });
      if (fetchError) throw fetchError;
      setBroadcasts((data ?? []) as HttpSmsBroadcastRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load httpSMS broadcasts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBroadcasts();
  }, [fetchBroadcasts]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => router.push('/broadcasts')} className="border-border">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
              <MessagesSquare className="h-5 w-5 text-primary" />
              httpSMS Campaigns
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Bulk SMS sent via your connected httpSMS numbers.</p>
          </div>
        </div>
        <Button
          onClick={() => router.push('/broadcasts/new-httpsms')}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New httpSMS Broadcast
        </Button>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm text-red-300">
          {error}
        </div>
      ) : broadcasts.length === 0 ? (
        <div className="rounded-xl border border-border bg-card/50 p-10 text-center">
          <p className="text-sm text-muted-foreground">No httpSMS campaigns yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Total</th>
                <th className="px-4 py-2 text-left">Sent</th>
                <th className="px-4 py-2 text-left">Failed</th>
                <th className="px-4 py-2 text-left">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {broadcasts.map((b) => (
                <tr
                  key={b.id}
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={() => router.push(`/broadcasts/httpsms/${b.id}`)}
                >
                  <td className="px-4 py-2 text-foreground">{b.name}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[b.status]}`}>
                      {b.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{b.total_recipients}</td>
                  <td className="px-4 py-2 text-primary">{b.sent_count}</td>
                  <td className="px-4 py-2 text-red-400">{b.failed_count}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {new Date(b.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
