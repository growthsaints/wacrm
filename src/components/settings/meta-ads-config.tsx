'use client';

// ============================================================
// Settings → Meta Ads — connect a Meta Ad Account via a System User
// access token (see migration 086's header comment for why this is a
// paste-a-token form rather than an OAuth "Connect" button: Advanced
// Access for third-party ad accounts needs an App Review this app
// doesn't have yet — a manually-generated System User token works
// today for any ad account willing to add this app as a Business
// partner). Same BYO-credential pattern as httpSMS/AI config.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Megaphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsPanelHead } from './settings-panel-head';

interface MetaAdsConfigRow {
  id: string;
  ad_account_id: string;
  connected_name: string | null;
  currency: string | null;
  enabled: boolean;
  created_at: string;
}

export function MetaAdsConfig() {
  const [config, setConfig] = useState<MetaAdsConfigRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [adAccountId, setAdAccountId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/meta-ads/config', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setConfig((data.config as MetaAdsConfigRow) ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = useCallback(async () => {
    if (!adAccountId.trim() || !accessToken.trim()) {
      toast.error('Enter both the Ad Account ID and the access token.');
      return;
    }
    setConnecting(true);
    try {
      const res = await fetch('/api/meta-ads/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad_account_id: adAccountId.trim(), access_token: accessToken.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't connect the ad account.");
        return;
      }
      toast.success(`Connected "${data.config.connected_name}".`);
      setAdAccountId('');
      setAccessToken('');
      await load();
    } catch {
      toast.error("Couldn't connect the ad account.");
    } finally {
      setConnecting(false);
    }
  }, [adAccountId, accessToken, load]);

  const disconnect = useCallback(async () => {
    if (!window.confirm('Disconnect this ad account? Existing Custom Audiences on Meta are not deleted.')) return;
    const res = await fetch('/api/meta-ads/config', { method: 'DELETE' });
    if (!res.ok) {
      toast.error("Couldn't disconnect the ad account.");
      return;
    }
    await load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <SettingsPanelHead
        title="Meta Ads"
        description="Connect a Meta Ad Account to build Custom Audiences from your CRM contacts for retargeting via Facebook/Instagram ads."
      />

      {config ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
          <Megaphone className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {config.connected_name ?? config.ad_account_id}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {config.ad_account_id} · {config.currency ?? '—'}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={disconnect}
            className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Ad Account ID</label>
            <Input
              value={adAccountId}
              onChange={(e) => setAdAccountId(e.target.value)}
              placeholder="act_1234567890 (from Business Settings → Ad Accounts)"
              className="bg-muted text-foreground"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">System User Access Token</label>
            <Input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="Generated from Business Settings → System Users"
              className="bg-muted text-foreground"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Generate this in Meta Business Settings → Users → System Users → (your system user) → Generate
            new token, with <code className="font-mono">ads_management</code> and{' '}
            <code className="font-mono">ads_read</code> permissions. The system user must already have
            access to this ad account.
          </p>
          <Button onClick={connect} disabled={connecting}>
            {connecting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Connect
          </Button>
        </div>
      )}
    </div>
  );
}
