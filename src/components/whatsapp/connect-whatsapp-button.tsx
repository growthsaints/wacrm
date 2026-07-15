'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import confetti from 'canvas-confetti';

import { Button } from '@/components/ui/button';

// AiSensy-style celebration burst for a newly-live WABA — purely
// cosmetic, fires once right after the success toast.
function celebrateWabaLive() {
  const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899'];
  confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 }, colors });
  confetti({ particleCount: 60, angle: 60, spread: 55, origin: { x: 0, y: 0.7 }, colors });
  confetti({ particleCount: 60, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors });
}

// Minimal ambient shape for the Facebook JS SDK — we only use the two
// calls Embedded Signup needs, not the full SDK surface.
declare global {
  interface Window {
    FB?: {
      init: (params: {
        appId: string;
        autoLogAppEvents?: boolean;
        xfbml?: boolean;
        version: string;
      }) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } | null }) => void,
        options: {
          config_id: string;
          response_type: 'code';
          override_default_response_type: true;
          extras?: Record<string, unknown>;
        },
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

// Meta's WhatsApp Embedded Signup posts progress/result to the parent
// window via `message` events shaped like:
//   { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH' | 'CANCEL' | 'ERROR',
//     data: { phone_number_id, waba_id, business_id?, current_step, error_message? } }
// This is the documented contract — there's no SDK helper for it, so
// we listen for `message` directly.
interface EmbeddedSignupMessage {
  type: string;
  event: 'FINISH' | 'CANCEL' | 'ERROR' | string;
  data?: {
    phone_number_id?: string;
    waba_id?: string;
    business_id?: string;
    error_message?: string;
  };
}

interface PendingSignupInfo {
  wabaId: string;
  phoneNumberId: string;
  businessId?: string;
}

const META_JS_SDK_VERSION = 'v25.0';

export function ConnectWhatsAppButton({
  onConnected,
}: {
  /** Called after the server finishes automatic setup, success or partial. */
  onConnected: () => void;
}) {
  const t = useTranslations('Settings.whatsappManagement');
  const [sdkReady, setSdkReady] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const configId = process.env.NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID;
  const configured = Boolean(appId && configId);

  // Whichever of {code} (from FB.login's callback) and
  // {wabaId, phoneNumberId} (from the postMessage) arrives first is
  // stashed here; the completion call only fires once both are in,
  // since the two events aren't guaranteed to arrive in order.
  const pendingCodeRef = useRef<string | null>(null);
  const pendingInfoRef = useRef<PendingSignupInfo | null>(null);
  const completingRef = useRef(false);

  const complete = useCallback(
    async (code: string, info: PendingSignupInfo) => {
      if (completingRef.current) return;
      completingRef.current = true;
      setConnecting(true);
      try {
        const res = await fetch('/api/whatsapp/embedded-signup/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            wabaId: info.wabaId,
            phoneNumberId: info.phoneNumberId,
            businessId: info.businessId,
          }),
        });
        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          toast.error(t('connectFailed', { reason: payload.error || 'Unknown error' }));
          return;
        }

        if (payload.success) {
          toast.success(t('connectedSuccess', { name: payload.business_name || payload.phone_info?.display_phone_number || 'WhatsApp' }));
          celebrateWabaLive();
        } else {
          toast.error(t('connectedPartial', { reason: payload.registration_error || 'Unknown error' }), {
            duration: 12000,
          });
        }
        onConnected();
      } catch {
        toast.error(t('connectFailed', { reason: 'Network error' }));
      } finally {
        setConnecting(false);
        completingRef.current = false;
        pendingCodeRef.current = null;
        pendingInfoRef.current = null;
      }
    },
    [onConnected, t],
  );

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Facebook posts from its own domains; the payload is JSON text.
      if (
        typeof event.origin !== 'string' ||
        !/(^https:\/\/www\.facebook\.com$|^https:\/\/web\.facebook\.com$)/.test(event.origin)
      ) {
        return;
      }
      let message: EmbeddedSignupMessage;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type !== 'WA_EMBEDDED_SIGNUP') return;

      if (message.event === 'CANCEL') {
        toast(t('cancelled'));
        setConnecting(false);
        pendingCodeRef.current = null;
        pendingInfoRef.current = null;
        return;
      }

      if (message.event === 'ERROR') {
        toast.error(t('connectFailed', { reason: message.data?.error_message || 'Facebook reported an error' }));
        setConnecting(false);
        pendingCodeRef.current = null;
        pendingInfoRef.current = null;
        return;
      }

      if (message.event === 'FINISH') {
        const { waba_id, phone_number_id, business_id } = message.data ?? {};
        if (!waba_id || !phone_number_id) return;
        pendingInfoRef.current = { wabaId: waba_id, phoneNumberId: phone_number_id, businessId: business_id };
        if (pendingCodeRef.current) {
          void complete(pendingCodeRef.current, pendingInfoRef.current);
        }
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [complete, t]);

  function handleConnect() {
    if (!window.FB || !appId || !configId) return;
    setConnecting(true);
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          // No code and no CANCEL postMessage yet (e.g. the user closed
          // the popup manually) — treat as cancelled.
          setConnecting(false);
          return;
        }
        pendingCodeRef.current = code;
        if (pendingInfoRef.current) {
          void complete(code, pendingInfoRef.current);
        }
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
      },
    );
  }

  if (!configured) {
    return <p className="text-sm text-muted-foreground">{t('notConfigured')}</p>;
  }

  return (
    <>
      <Script
        src="https://connect.facebook.net/en_US/sdk.js"
        strategy="afterInteractive"
        onLoad={() => {
          window.fbAsyncInit = () => {
            window.FB?.init({ appId: appId!, autoLogAppEvents: true, xfbml: true, version: META_JS_SDK_VERSION });
            setSdkReady(true);
          };
          // The SDK calls fbAsyncInit itself once loaded from the
          // script's own bootstrap — but since we attached the script
          // with next/script (already loaded by the time onLoad fires),
          // invoke it directly rather than waiting for a call that has
          // already happened.
          window.fbAsyncInit();
        }}
      />
      <Button onClick={handleConnect} disabled={!sdkReady || connecting} size="lg">
        {connecting ? <Loader2 className="size-4 animate-spin" /> : null}
        {connecting ? t('connecting') : t('continueWithFacebook')}
      </Button>
    </>
  );
}
