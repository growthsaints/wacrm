'use client';

// ============================================================
// Settings → Commerce (Milestone 4, Parts 4 & 5)
//
// WooCommerce / Shopify connection wizard. One step: paste
// credentials, we validate against the real store API, register our
// webhook automatically (no manual client-side webhook setup), and
// queue the initial sync. Encrypted credentials never round-trip
// back to the client after creation.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plug, RefreshCw, ShoppingBag, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { SettingsPanelHead } from './settings-panel-head';

interface ConnectionRow {
  id: string;
  platform: 'woocommerce' | 'shopify';
  store_url: string;
  status: 'connected' | 'error' | 'disconnected';
  last_error: string | null;
  last_synced_at: string | null;
  created_at: string;
}

export function CommerceSettings() {
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardPlatform, setWizardPlatform] = useState<'woocommerce' | 'shopify' | null>(null);
  const [storeUrl, setStoreUrl] = useState('');
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/commerce/connections', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setConnections(json.connections ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetWizard() {
    setWizardPlatform(null);
    setStoreUrl('');
    setConsumerKey('');
    setConsumerSecret('');
    setAccessToken('');
  }

  async function handleConnect() {
    if (!wizardPlatform || !storeUrl.trim()) {
      toast.error('Store URL is required');
      return;
    }
    setConnecting(true);
    try {
      const res = await fetch('/api/commerce/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: wizardPlatform,
          store_url: storeUrl.trim(),
          ...(wizardPlatform === 'woocommerce'
            ? { consumer_key: consumerKey, consumer_secret: consumerSecret }
            : { access_token: accessToken }),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Connection failed');
        return;
      }
      toast.success(`Connected — syncing orders, customers, and products in the background.`);
      resetWizard();
      void load();
    } finally {
      setConnecting(false);
    }
  }

  async function handleResync(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/commerce/connections/${id}`, { method: 'POST' });
      if (res.ok) toast.success('Sync queued');
      else toast.error('Failed to queue sync');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDisconnect(id: string) {
    if (!window.confirm('Disconnect this store? Synced order history is kept.')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/commerce/connections/${id}`, { method: 'DELETE' });
      if (res.ok) setConnections((prev) => prev.filter((c) => c.id !== id));
      else toast.error('Failed to disconnect');
    } finally {
      setBusyId(null);
    }
  }

  const hasWoo = connections.some((c) => c.platform === 'woocommerce');
  const hasShopify = connections.some((c) => c.platform === 'shopify');

  return (
    <section>
      <SettingsPanelHead
        title="Commerce"
        description="Connect WooCommerce or Shopify to sync orders, customers, and products, and trigger WhatsApp automations on order events."
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-3">
          {connections.map((conn) => (
            <Card key={conn.id}>
              <CardContent className="flex items-center gap-4 py-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ShoppingBag className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium capitalize text-foreground">{conn.platform}</span>
                    <Badge
                      className={
                        conn.status === 'connected'
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-red-500/40 bg-red-500/10 text-red-400'
                      }
                    >
                      {conn.status}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{conn.store_url}</p>
                  {conn.last_error && <p className="mt-0.5 text-xs text-red-400">{conn.last_error}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleResync(conn.id)} disabled={busyId === conn.id}>
                    <RefreshCw className="size-3.5" />
                    Sync now
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDisconnect(conn.id)}
                    disabled={busyId === conn.id}
                    className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          <div className="flex gap-3">
            {!hasWoo && (
              <Button variant="outline" onClick={() => setWizardPlatform('woocommerce')}>
                <Plug className="size-4" />
                Connect WooCommerce
              </Button>
            )}
            {!hasShopify && (
              <Button variant="outline" onClick={() => setWizardPlatform('shopify')}>
                <Plug className="size-4" />
                Connect Shopify
              </Button>
            )}
          </div>
        </div>
      )}

      <Dialog open={wizardPlatform !== null} onOpenChange={(open) => !open && resetWizard()}>
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground capitalize">
              Connect {wizardPlatform}
            </DialogTitle>
            <DialogDescription>
              {wizardPlatform === 'woocommerce'
                ? 'Generate a REST API key pair in WooCommerce → Settings → Advanced → REST API.'
                : 'Generate an Admin API access token from your store\'s Settings → Apps → Develop apps.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Store URL</Label>
              <Input
                value={storeUrl}
                onChange={(e) => setStoreUrl(e.target.value)}
                placeholder={wizardPlatform === 'shopify' ? 'your-store.myshopify.com' : 'https://yourstore.com'}
                className="bg-muted"
              />
            </div>
            {wizardPlatform === 'woocommerce' ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Consumer key</Label>
                  <Input value={consumerKey} onChange={(e) => setConsumerKey(e.target.value)} className="bg-muted font-mono text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Consumer secret</Label>
                  <Input
                    type="password"
                    value={consumerSecret}
                    onChange={(e) => setConsumerSecret(e.target.value)}
                    className="bg-muted font-mono text-xs"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Admin API access token</Label>
                <Input
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  className="bg-muted font-mono text-xs"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetWizard} disabled={connecting}>
              Cancel
            </Button>
            <Button onClick={handleConnect} disabled={connecting}>
              {connecting ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
              Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
