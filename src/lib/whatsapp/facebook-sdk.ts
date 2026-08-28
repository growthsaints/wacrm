// ============================================================
// Shared "is the Facebook JS SDK ready" flag for ConnectWhatsAppButton.
//
// The button can now be mounted more than once on the same page at
// the same time (the header's TopStatusBar + the dashboard's
// onboarding checklist, both showing "Connect" for a brand-new,
// not-yet-connected account) — each instance used to track its own
// local `sdkReady` state, set only by its OWN <Script onLoad>. Next.js
// dedupes the actual <script src> request across instances, but only
// ONE mounted instance's onLoad reliably fires per navigation — the
// others silently never learn the SDK loaded, leaving their button
// disabled until a refresh happens to make a different instance win
// the race. A module-level flag shared via a tiny pub-sub fixes this:
// whichever instance's onLoad fires marks the SDK ready for everyone.
// ============================================================

// Shared ambient shape for the Facebook JS SDK — declared once here
// (rather than per-component) since TypeScript requires every
// declaration of the same global interface member to match exactly;
// two components each declaring their own slightly-different `Window.FB`
// shape (e.g. one with `extras`, one without) fails to compile.
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

let ready = false;
const listeners = new Set<() => void>();

export function markFacebookSdkReady(): void {
  if (ready) return;
  ready = true;
  listeners.forEach((listener) => listener());
}

export function isFacebookSdkReady(): boolean {
  return ready;
}

export function subscribeFacebookSdkReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
