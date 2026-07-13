import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { UnauthorizedError } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { PlatformShell } from "./platform-shell";

// Same "noindex" posture as the tenant dashboard — this is an
// internal operator console, never meant to be crawled or linked to
// from outside the app.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requirePlatformAdmin();
  } catch (err) {
    // No session at all → let them log in first. Signed in but not a
    // platform admin → fail closed into their own workspace rather
    // than exposing "you're not allowed here" as a distinct state.
    redirect(err instanceof UnauthorizedError ? "/login" : "/dashboard");
  }

  return <PlatformShell>{children}</PlatformShell>;
}
