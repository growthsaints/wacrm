'use client';

// ============================================================
// Settings → Meta Ads — connect a Meta Ad Account either via
// "Connect with Facebook" (OAuth, self-serve — see
// components/meta-ads/connect-meta-ads-button.tsx and
// api/meta-ads/oauth/complete/route.ts) or by pasting a System User
// access token generated manually. Both paths store the same thing
// (an encrypted token + ad_account_id) — OAuth just automates
// generating and verifying it. The OAuth button only shows once
// NEXT_PUBLIC_META_ADS_CONFIG_ID is set (see .env.local.example); it
// requires Meta App Review (Advanced Access) to work for ad accounts
// outside this Meta App's own admins/testers — until then, or for any
// admin who'd rather not grant wacrm's Meta App OAuth access at all,
// the manual field below always works (same BYO-credential pattern as
// httpSMS/AI config).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Megaphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConnectMetaAdsButton } from '@/components/meta-ads/connect-meta-ads-button';
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
        <div className="space-y-3">
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
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
            <p className="mb-2 font-medium">
              One-time setup on Meta&apos;s side — do these once per ad account, ideally before creating
              your first audience or campaign, so you never hit them as a confusing failure later:
            </p>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Add a payment method to this ad account in{' '}
                <a
                  href="https://www.facebook.com/adsmanager"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline underline-offset-2"
                >
                  Ads Manager
                </a>{' '}
                → Billing settings — Meta refuses to launch any campaign, even paused, without one.
              </li>
              <li>
                Accept Meta&apos;s Customer List Terms for this ad account —{' '}
                <a
                  href={`https://business.facebook.com/ads/manage/customaudiences/tos/?act=${config.ad_account_id.replace(/^act_/, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline underline-offset-2"
                >
                  accept them here
                </a>{' '}
                — required before any Custom Audience with an uploaded contact list can be created.
              </li>
              <li>
                Certify compliance with Meta&apos;s Non-Discrimination Policy —{' '}
                <a
                  href="https://www.facebook.com/certification/nondiscrimination"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline underline-offset-2"
                >
                  certify here
                </a>
                . On a brand-new Business Portfolio this can be blocked until the business itself is
                verified (Business Settings → Security Center → Verify Business). Complete that
                verification — do not assign this ad account or WhatsApp Business Account to a System
                User belonging to a different, unrelated business as a shortcut. Meta treats one System
                User holding assets across unconnected businesses as a policy-circumvention signal and
                can suspend the entire Business Portfolio (ads AND WhatsApp API access) for it.
              </li>
              <li>The Facebook Page you&apos;ll pick for a campaign needs a WhatsApp number linked to it in Business Manager.</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <ConnectMetaAdsButton onConnected={load} />
          <div className="relative py-1 text-center text-[11px] text-muted-foreground">
            <span className="relative bg-card px-2">or connect manually</span>
            <div className="absolute inset-x-0 top-1/2 -z-10 h-px bg-border" />
          </div>
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
