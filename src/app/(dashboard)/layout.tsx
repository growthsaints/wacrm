import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DashboardShell } from "./dashboard-shell";
import {
  decodeImpersonationCookie,
  IMPERSONATION_COOKIE,
} from "@/lib/platform/impersonation";

// Server layout whose only job is to declare "do not index" metadata
// for the authed app. robots.ts already disallows these paths at the
// crawler-level and middleware redirects unauthenticated visitors, so
// this is belt-and-suspenders — but SEO-critical if a URL ever leaks
// via a link shared externally.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side read of the impersonation cookie (see
  // src/lib/platform/impersonation.ts) so the "Viewing as X" banner
  // renders without a client round trip. Absent for the overwhelming
  // majority of requests — only set while a platform admin is mid
  // "Login as Client".
  const cookieStore = await cookies();
  const impersonation = decodeImpersonationCookie(
    cookieStore.get(IMPERSONATION_COOKIE)?.value,
  );

  return (
    <DashboardShell impersonatingAccountName={impersonation?.accountName ?? null}>
      {children}
    </DashboardShell>
  );
}
