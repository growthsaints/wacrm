"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { useRealtime } from "@/hooks/use-realtime";
import {
  playNewMessageSound,
  primeNotificationAudio,
} from "@/lib/notification-sound";
import type { Message } from "@/types";

/**
 * NotificationSoundListener — headless. Mounted once in the dashboard
 * shell (below the auth gate), so it stays alive across every page —
 * Dashboard, Contacts, Settings, etc. — not just while Inbox itself is
 * open.
 *
 * Inbox has its own realtime subscription (in inbox/page.tsx) that
 * already plays a sound for genuine inbound customer messages — soft
 * tone if the message lands in the conversation the agent has open,
 * louder chime otherwise. This listener only covers the gap: when the
 * agent isn't on the Inbox page at all, nothing else is listening, so
 * it plays the louder chime itself. It stays silent while on /inbox to
 * avoid the same message playing twice through two channels.
 */
export function NotificationSoundListener() {
  const pathname = usePathname();

  useEffect(() => {
    const prime = () => {
      primeNotificationAudio();
      document.removeEventListener("click", prime);
      document.removeEventListener("keydown", prime);
    };
    document.addEventListener("click", prime);
    document.addEventListener("keydown", prime);
    return () => {
      document.removeEventListener("click", prime);
      document.removeEventListener("keydown", prime);
    };
  }, []);

  useRealtime({
    channelName: "app-notification-sound",
    onMessageEvent: (event: { eventType: string; new: Message }) => {
      if (event.eventType !== "INSERT") return;
      if (event.new.sender_type !== "customer") return;
      if (pathname === "/inbox") return;
      playNewMessageSound();
    },
  });

  return null;
}
