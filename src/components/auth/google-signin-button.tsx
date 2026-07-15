"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.82-.07-1.6-.2-2.36H12v4.47h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.73z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.9l-3.88-3c-1.08.72-2.45 1.15-4.05 1.15-3.11 0-5.75-2.1-6.69-4.92H1.3v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.31 14.33A7.2 7.2 0 0 1 4.9 12c0-.81.14-1.6.4-2.33V6.58H1.3A11.98 11.98 0 0 0 0 12c0 1.93.46 3.76 1.3 5.42l4.01-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.94 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.3 6.58l4.01 3.09C6.25 6.85 8.89 4.75 12 4.75z"
      />
    </svg>
  );
}

/**
 * `next` is where /auth/callback sends the browser after Google
 * hands back an auth code — /dashboard normally, or /join/<token>
 * when this button is rendered on the invite-accept variant of
 * login/signup, mirroring the same `next` handling the email/
 * password flows already do for invites and password recovery.
 */
export function GoogleSignInButton({
  next,
  label,
}: {
  next: string;
  label: string;
}) {
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  async function handleClick() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    // Success navigates the whole page away to Google — there's
    // nothing further to do here. An error means that navigation
    // never happens, so it's the only outcome worth un-loading for.
    if (error) setLoading(false);
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      disabled={loading}
      className="h-10 w-full gap-2 border-border text-foreground hover:bg-muted"
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : <GoogleLogo />}
      {label}
    </Button>
  );
}
