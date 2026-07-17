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
  label,
  size = 'lg',
}: {
  /** Called after the server finishes automatic setup, success or partial. */
  onConnected: () => void;
  /** Overrides the default "Continue with Facebook" text — used by the
   *  dashboard top status bar, which wants a shorter "Apply Now". */
  label?: string;
  size?: React.ComponentProps<typeof Button>['size'];
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

  // Belt-and-suspenders for a popup the user closes by hand. FB.login's
  // own callback normally fires even then, but Meta's own reference
  // Tech Provider sample app defends against the rare case where it
  // doesn't (browser popup-blocker quirks, etc.) by tracking the popup
  // window itself and polling for `.closed` — otherwise `connecting`
  // can get stuck true forever with no path back to an idle button.
  const popupWindowRef = useRef<Window | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    popupWindowRef.current = null;
  }, []);

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
        stopPolling();
      }
    },
    [onConnected, t, stopPolling],
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
        stopPolling();
        return;
      }

      if (message.event === 'ERROR') {
        toast.error(t('connectFailed', { reason: message.data?.error_message || 'Facebook reported an error' }));
        setConnecting(false);
        pendingCodeRef.current = null;
        pendingInfoRef.current = null;
        stopPolling();
        return;
      }

      if (message.event === 'FINISH') {
        const { waba_id, phone_number_id, business_id } = message.data ?? {};
        if (!waba_id || !phone_number_id) {
          // Facebook reported completion but didn't hand back the ids
          // we need to finish setup server-side. Surface this instead
          // of silently leaving the button spinning until the popup-
          // closed poll eventually resets it with no explanation.
          toast.error(t('connectFailed', { reason: 'Facebook did not return a WhatsApp number to connect' }));
          setConnecting(false);
          pendingCodeRef.current = null;
          pendingInfoRef.current = null;
          stopPolling();
          return;
        }
        pendingInfoRef.current = { wabaId: waba_id, phoneNumberId: phone_number_id, businessId: business_id };
        if (pendingCodeRef.current) {
          void complete(pendingCodeRef.current, pendingInfoRef.current);
        }
      }
    }

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      stopPolling();
    };
  }, [complete, t, stopPolling]);

  function handleConnect() {
    if (!window.FB || !appId || !configId) return;
    setConnecting(true);
    stopPolling();

    // Capture the popup FB.login opens so we can detect a manual close.
    // FB.login opens it synchronously before invoking its callback, so
    // briefly patching window.open catches the reference.
    const originalWindowOpen = window.open;
    window.open = (...args: Parameters<typeof window.open>) => {
      const popup = originalWindowOpen.apply(window, args);
      popupWindowRef.current = popup;
      window.open = originalWindowOpen; // restore immediately
      return popup;
    };

    window.FB.login(
      (response) => {
        stopPolling();
        const code = response.authResponse?.code;
        if (!code) {
          // No code and no CANCEL postMessage yet (e.g. the user closed
          // the popup manually) — treat as cancelled, same as the
          // explicit CANCEL postMessage branch above (which does toast)
          // so this path isn't silently different.
          toast(t('cancelled'));
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
        // 'v4' is Meta's current-recommended-for-production Embedded Signup
        // version (confirmed against the Embedded Signup Builder wizard and
        // Meta's own reference Tech Provider sample app) — omitting it falls
        // back to an older ES version with a different flow/screens.
        extras: { sessionInfoVersion: '3', version: 'v4' },
      },
    );

    // Fallback for the rare case FB.login's own callback never fires
    // after the user manually closes the popup. Guarded on
    // completingRef so it never fires once a real FINISH is already
    // being processed — Facebook closes the popup itself on finish,
    // and that's expected, not a cancellation.
    pollTimerRef.current = setInterval(() => {
      if (completingRef.current) {
        stopPolling();
        return;
      }
      if (popupWindowRef.current?.closed) {
        stopPolling();
        setConnecting(false);
      }
    }, 500);
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
      <Button onClick={handleConnect} disabled={!sdkReady || connecting} size={size}>
        {connecting ? <Loader2 className="size-4 animate-spin" /> : null}
        {connecting ? t('connecting') : (label ?? t('continueWithFacebook'))}
      </Button>
    </>
  );
}
