"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BroadcastQueue, QueuedBroadcast } from "@/lib/enterprise/queries";

function BroadcastList({ items }: { items: QueuedBroadcast[] }) {
  if (items.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">Nothing here.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map((b) => (
        <div key={b.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-foreground">{b.name}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(b.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{b.totalRecipients} recipients</span>
            <span>{b.deliveredCount} delivered</span>
            {b.failedCount > 0 && <Badge variant="destructive">{b.failedCount} failed</Badge>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function BroadcastQueuePage() {
  const [data, setData] = useState<BroadcastQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/enterprise/broadcast-queue")
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setData(json.queue ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (notEnabled || !data) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Broadcast Queue isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        A read-only view of your broadcasts by status — there&apos;s no
        pause/resume capability in the send engine yet, so this shows
        real state rather than controls that wouldn&apos;t do anything.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Running ({data.running.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <BroadcastList items={data.running} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Queued ({data.queued.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <BroadcastList items={data.queued} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Completed ({data.completed.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <BroadcastList items={data.completed} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Failed ({data.failed.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <BroadcastList items={data.failed} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
