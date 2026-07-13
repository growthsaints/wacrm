"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";

/**
 * Lightweight client-side probe for "does this signed-in user get a
 * Super Admin link?" Deliberately separate from `useAuth()` — platform
 * admin is not part of the tenant `AccountRole` model, and most users
 * are never one, so this stays a cheap opt-in fetch rather than
 * bloating the auth context every page already depends on.
 */
export function usePlatformAdmin(): boolean {
  const { user } = useAuth();
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  useEffect(() => {
    // No stale-state concern on sign-out: `useAuth().signOut()` does a
    // full `window.location.href` navigation, which remounts this hook
    // fresh — so skipping work here (rather than resetting state
    // synchronously) never leaves a stale "true" showing.
    if (!user) return;
    let cancelled = false;
    fetch("/api/platform/whoami", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { isPlatformAdmin: false }))
      .then((data: { isPlatformAdmin?: boolean }) => {
        if (!cancelled) setIsPlatformAdmin(!!data.isPlatformAdmin);
      })
      .catch(() => {
        if (!cancelled) setIsPlatformAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return isPlatformAdmin;
}
