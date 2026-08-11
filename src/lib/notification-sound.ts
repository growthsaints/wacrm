"use client";

// ============================================================
// Inbox notification sounds — generated with the Web Audio API rather
// than shipping audio files, so there's nothing to host/deploy. Two
// distinct tones:
//   - playNewMessageSound: a message in a conversation the agent isn't
//     currently viewing (louder, two-note chime — meant to be noticed).
//   - playInChatMessageSound: a message arriving in the conversation
//     already open (quiet, single soft tone — a light confirmation,
//     not an interruption).
//
// Browsers block audio until the page has had at least one user
// gesture (click/keypress) — the AudioContext stays "suspended" until
// then, and these calls silently no-op rather than throwing. Once the
// agent clicks anywhere in the app, subsequent calls play normally.
// ============================================================

/** Device-scoped (localStorage), same pattern as theme/mode prefs. */
export const NOTIFICATION_SOUND_STORAGE_KEY =
  "wacrm:inbox:notification-sound-enabled";

/** Defaults to enabled — only "false" turns it off. */
export function isNotificationSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(NOTIFICATION_SOUND_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setNotificationSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(NOTIFICATION_SOUND_STORAGE_KEY, String(enabled));
  } catch {
    // localStorage can throw in private-browsing / sandboxed contexts;
    // the setting just won't persist across reloads in that case.
  }
}

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
  return audioCtx;
}

function playTone(
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  volume: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

/** New message in a conversation that isn't the one currently open. */
export function playNewMessageSound(): void {
  if (!isNotificationSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  playTone(ctx, 880, now, 0.12, 0.18);
  playTone(ctx, 1175, now + 0.1, 0.15, 0.18);
}

/** New message inside the conversation the agent already has open. */
export function playInChatMessageSound(): void {
  if (!isNotificationSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  playTone(ctx, 660, now, 0.09, 0.06);
}

/**
 * Creates/resumes the AudioContext synchronously inside a real user
 * gesture (click/keydown). Some browsers (notably Safari) only unlock
 * Web Audio when it's started directly inside a gesture handler — a
 * context created later, in response to a Realtime message arriving,
 * can stay silently suspended forever. Call this once from a
 * document-level click/keydown listener so playback is unlocked
 * before the first real notification needs to play.
 */
export function primeNotificationAudio(): void {
  getAudioContext();
}
