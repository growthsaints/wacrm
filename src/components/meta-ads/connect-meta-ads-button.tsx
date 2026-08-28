'use client';

// ============================================================
// "Connect with Facebook" for Meta Ads — the self-serve counterpart
// to the manual BYO System User token field in meta-ads-config.tsx.
// Mirrors ConnectWhatsAppButton's Facebook Login for Business pattern
// (same shared SDK-ready store, same config_id-based FB.login), but
// simpler: no WA_EMBEDDED_SIGNUP postMessage contract to listen for —
// Meta hands back an authorization `code` directly in FB.login's own
// callback, and POST /api/meta-ads/oauth/complete does the rest
// (exchange code → list ad accounts → pick one → store it).
//
// Requires its own Facebook Login for Business Configuration in the
// Meta App dashboard (Ads-specific: ads_management, ads_read,
// business_management, pages_show_list), configured via
// NEXT_PUBLIC_META_ADS_CONFIG_ID — separate from the WhatsApp one
// since they request different permissions for a different purpose.
// ============================================================

import { useState, useSyncExternalStore } from 'react';
import Script from 'next/script';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  isFacebookSdkReady,
  markFacebookSdkReady,
  subscribeFacebookSdkReady,
} from '@/lib/whatsapp/facebook-sdk';

const META_JS_SDK_VERSION = 'v25.0';

export function ConnectMetaAdsButton({ onConnected }: { onConnected: () => void }) {
  const sdkReady = useSyncExternalStore(subscribeFacebookSdkReady, isFacebookSdkReady, () => false);
  const [connecting, setConnecting] = useState(false);

  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const configId = process.env.NEXT_PUBLIC_META_ADS_CONFIG_ID;
  const configured = Boolean(appId && configId);

  function handleConnect() {
    if (!window.FB || !appId || !configId) return;
    setConnecting(true);

    window.FB.login(
      async (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          toast('Connection cancelled.');
          setConnecting(false);
          return;
        }
        try {
          const res = await fetch('/api/meta-ads/oauth/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            toast.error(data.error ?? "Couldn't connect the ad account.");
            return;
          }
          const name = data.config?.connected_name ?? 'your ad account';
          if (data.totalAdAccounts > 1) {
            toast.success(`Connected "${name}" — you administer ${data.totalAdAccounts} ad accounts; this was picked automatically. Use the manual field below to switch to a different one.`, {
              duration: 10000,
            });
          } else {
            toast.success(`Connected "${name}".`);
          }
          onConnected();
        } catch {
          toast.error('Network error connecting the ad account.');
        } finally {
          setConnecting(false);
        }
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
      },
    );
  }

  if (!configured) {
    return null;
  }

  return (
    <>
      <Script
        src="https://connect.facebook.net/en_US/sdk.js"
        strategy="afterInteractive"
        onLoad={() => {
          window.fbAsyncInit = () => {
            window.FB?.init({ appId: appId!, autoLogAppEvents: true, xfbml: true, version: META_JS_SDK_VERSION });
            markFacebookSdkReady();
          };
          window.fbAsyncInit();
        }}
      />
      <Button type="button" onClick={handleConnect} disabled={!sdkReady || connecting}>
        {connecting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
        {connecting ? 'Connecting…' : 'Connect with Facebook'}
      </Button>
    </>
  );
}
