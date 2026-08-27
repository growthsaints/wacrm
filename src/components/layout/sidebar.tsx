"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { SUPPORT_WHATSAPP_URL } from "@/lib/support";
import { useAuth } from "@/hooks/use-auth";
import { usePlatformAdmin } from "@/hooks/use-platform-admin";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useEnterpriseFeatures } from "@/hooks/use-enterprise-features";
import { useBusinessWorkspaceFeatures } from "@/hooks/use-business-workspace-features";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import {
  Bell,
  Bot,
  Briefcase,
  Building2,
  Crown,
  GitBranch,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  MessageSquare,
  Radio,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces — when a designer
// wants to recolour "agent" rows, this is the one diff.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: "roleOwner",
    // Amber: scarce, immutable, "the boss" — gets visual emphasis.
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  admin: {
    icon: Shield,
    labelKey: "roleAdmin",
    // Primary-tinted: significant but not as scarce as owner.
    className:
      "border-primary/40 bg-primary/10 text-primary",
  },
  agent: {
    icon: UserCog,
    labelKey: "roleAgent",
    // Neutral slate: the operational default.
    className:
      "border-border bg-muted text-foreground",
  },
  viewer: {
    icon: User,
    labelKey: "roleViewer",
    // Muted slate: read-only role; visually quieter than agent.
    className:
      "border-border bg-card text-muted-foreground",
  },
};
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational — doesn't affect routing or access.
   */
  beta?: boolean;
  /**
   * Admin+ always sees this item; an 'agent' only sees it with the
   * matching agent_feature_grants row (see useAuth's canAccessX).
   */
  requiredFeature?: "broadcasts" | "automations";
}

const navItems: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
  { href: "/notifications", labelKey: "notifications", icon: Bell },
  { href: "/contacts", labelKey: "contacts", icon: Users },
  { href: "/pipelines", labelKey: "pipelines", icon: GitBranch },
  { href: "/broadcasts", labelKey: "broadcasts", icon: Radio, requiredFeature: "broadcasts" },
  { href: "/automations", labelKey: "automations", icon: Zap, requiredFeature: "automations" },
  { href: "/flows", labelKey: "flows", icon: Workflow, beta: true },
  { href: "/agents", labelKey: "aiAgents", icon: Bot },
];

const bottomNavItems = [
  { href: "/settings", labelKey: "settings", icon: Settings },
  {
    href: SUPPORT_WHATSAPP_URL,
    labelKey: "contactSupport",
    icon: LifeBuoy,
    external: true,
  },
];

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

import { useTranslations } from "next-intl";

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const {
    profile,
    profileLoading,
    account,
    accountRole,
    signOut,
    canAccessBroadcasts,
    canAccessAutomations,
  } = useAuth();
  const visibleNavItems = navItems.filter((item) => {
    if (item.requiredFeature === "broadcasts") return canAccessBroadcasts;
    if (item.requiredFeature === "automations") return canAccessAutomations;
    return true;
  });
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  const isPlatformAdmin = usePlatformAdmin();
  const { enabled: enterpriseLicensed, features: enterpriseFeatures } = useEnterpriseFeatures();
  const enterpriseEnabled = enterpriseLicensed && Boolean(enterpriseFeatures.campaign_intelligence);
  const { enabled: businessWorkspaceEnabled } = useBusinessWorkspaceFeatures();
  // Only surface the account-name strip when it actually carries
  // information. A solo user's personal account is named after them
  // (the 017 signup trigger seeds it from `full_name`), so showing it
  // here would just duplicate the user name in the footer below. Once
  // the account is renamed or the user joins a shared account, the
  // name diverges and the strip becomes meaningful — that's the signal
  // we gate on. Wait for the profile fetch to settle first, otherwise
  // the strip flashes in once the row resolves (a layout jump).
  const showAccountStrip =
    !profileLoading &&
    !!account?.name &&
    account.name !== profile?.full_name;

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label={t("closeMenu")}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always-visible icon rail — reset all the
          // mobile framing and collapse to icon-rail width. Wide enough
          // that two-word labels (e.g. "Campaign Intelligence") wrap
          // onto a clean second line instead of clipping mid-word.
          "lg:static lg:z-0 lg:w-24 lg:translate-x-0 lg:transition-none",
        )}
        aria-label="Primary"
      >
        {/* Logo row. On mobile: icon + wordmark + close button. On the
            desktop icon rail there's no room for the wordmark, so it's
            hidden and the icon centers. */}
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-4 lg:justify-center lg:px-0">
          <Link href="/dashboard" className="flex items-center gap-2">
            <img
              src="/logo-mark.png"
              alt="Growth Saints"
              className="h-8 w-8 rounded-lg object-cover"
            />
            <span className="text-sm font-semibold text-sidebar-foreground lg:hidden">
              {t("title")}
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeMenu")}
            className="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 [scrollbar-width:none] lg:px-2 [&::-webkit-scrollbar]:hidden">
          <ul className="flex flex-col gap-1">
            {visibleNavItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));

              const showUnreadBadge =
                item.href === "/inbox" && totalUnread > 0 && !isActive;

              // Unlike the inbox dot, the notifications count stays visible
              // even while the page is active — it reflects unread state
              // (cleared by marking notifications read), not "currently
              // viewing this section".
              const showNotificationBadge =
                item.href === "/notifications" && unreadNotifications > 0;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    title={t(item.labelKey as string)}
                    className={cn(
                      // Mobile: icon + label side by side, taller rows so
                      // fingers can hit them reliably (≥44px). Desktop
                      // (lg): icon stacked over a small label — the
                      // AiSensy-style narrow icon rail.
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                      "lg:flex-col lg:gap-1 lg:rounded-xl lg:px-1.5 lg:py-2.5 lg:text-center lg:text-[10.5px] lg:leading-tight",
                      isActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                  >
                    <span className="relative flex shrink-0 items-center justify-center">
                      <item.icon className="h-4 w-4" />
                      {item.beta && (
                        <span
                          aria-hidden
                          className="hidden lg:block lg:absolute lg:-top-0.5 lg:-right-0.5 lg:h-1.5 lg:w-1.5 lg:rounded-full lg:bg-amber-400"
                        />
                      )}
                      {showUnreadBadge && (
                        <span
                          aria-hidden
                          className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground lg:-top-1 lg:-right-1.5 lg:h-3.5 lg:min-w-3.5 lg:px-0.5 lg:text-[8px]"
                        >
                          {totalUnread > 99 ? "99+" : totalUnread}
                        </span>
                      )}
                      {showNotificationBadge && (
                        <span
                          aria-hidden
                          className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground lg:-top-1 lg:-right-1.5 lg:h-3.5 lg:min-w-3.5 lg:px-0.5 lg:text-[8px]"
                        >
                          {unreadNotifications > 9 ? "9+" : unreadNotifications}
                        </span>
                      )}
                    </span>
                    <span className="flex-1 truncate lg:flex-none lg:w-full lg:overflow-visible lg:whitespace-normal lg:text-clip">
                      {t(item.labelKey as string)}
                    </span>
                    {item.beta && (
                      <span
                        aria-label={t("beta")}
                        className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300 lg:hidden"
                      >
                        {t("beta")}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          {enterpriseEnabled && (
            <>
              <div className="my-4 border-t border-sidebar-border" />
              <p className="mb-1.5 px-3 text-[10px] font-semibold tracking-wider text-sidebar-foreground/50 uppercase lg:hidden">
                Enterprise
              </p>
              <ul className="flex flex-col gap-1">
                <li>
                  <Link
                    href="/campaign-intelligence"
                    title="Campaign Intelligence"
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                      "lg:flex-col lg:gap-1 lg:rounded-xl lg:px-1.5 lg:py-2.5 lg:text-center lg:text-[10.5px] lg:leading-tight",
                      pathname.startsWith("/campaign-intelligence")
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                  >
                    <Building2 className="h-4 w-4 shrink-0" />
                    <span className="truncate lg:w-full lg:overflow-visible lg:whitespace-normal lg:text-clip">
                      Campaign Intelligence
                    </span>
                  </Link>
                </li>
              </ul>
            </>
          )}

          {businessWorkspaceEnabled && (
            <>
              <div className="my-4 border-t border-sidebar-border" />
              <p className="mb-1.5 px-3 text-[10px] font-semibold tracking-wider text-sidebar-foreground/50 uppercase lg:hidden">
                Business Workspace
              </p>
              <ul className="flex flex-col gap-1">
                <li>
                  <Link
                    href="/business-workspace"
                    title="Business Workspace"
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                      "lg:flex-col lg:gap-1 lg:rounded-xl lg:px-1.5 lg:py-2.5 lg:text-center lg:text-[10.5px] lg:leading-tight",
                      pathname.startsWith("/business-workspace")
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                  >
                    <Briefcase className="h-4 w-4 shrink-0" />
                    <span className="truncate lg:w-full lg:overflow-visible lg:whitespace-normal lg:text-clip">
                      Business Workspace
                    </span>
                  </Link>
                </li>
              </ul>
            </>
          )}

          <div className="my-4 border-t border-sidebar-border" />

          <ul className="flex flex-col gap-1">
            {bottomNavItems.map((item) => {
              const isActive = !item.external && pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    title={t(item.labelKey as string)}
                    {...(item.external
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                      "lg:flex-col lg:gap-1 lg:rounded-xl lg:px-1.5 lg:py-2.5 lg:text-center lg:text-[10.5px] lg:leading-tight",
                      isActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate lg:w-full lg:overflow-visible lg:whitespace-normal lg:text-clip">{t(item.labelKey as string)}</span>
                  </Link>
                </li>
              );
            })}
            {isPlatformAdmin && (
              <li>
                <Link
                  href="/platform"
                  title={t("superAdmin")}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:flex-col lg:gap-1 lg:rounded-xl lg:px-1.5 lg:py-2.5 lg:text-center lg:text-[10.5px] lg:leading-tight"
                >
                  <Shield className="h-4 w-4 shrink-0" />
                  <span className="truncate lg:w-full lg:overflow-visible lg:whitespace-normal lg:text-clip">{t("superAdmin")}</span>
                </Link>
              </li>
            )}
          </ul>
        </nav>

        {/* User section */}
        <div className="shrink-0 border-t border-sidebar-border p-3 lg:p-2">
          {/* Account name display — surfaced only when the account
              name differs from the user's own name (see
              `showAccountStrip`). For a default solo account the two
              match, so we hide it to avoid duplicating the user name
              below; for renamed or shared accounts it tells the user
              which account they're acting in. */}
          {showAccountStrip && account?.name ? (
            <div className="mb-2 flex items-center gap-2 px-3 text-xs text-sidebar-foreground/60 lg:hidden">
              <UsersRound className="size-3.5 shrink-0" />
              {/* `title=` exposes the full name on hover when it
                  gets truncated (long account names + narrow
                  sidebars). Cheap a11y win. */}
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole ? (
                // Always render the chip — owners used to be
                // invisible here, which made them indistinguishable
                // from admins at a glance. Now everyone sees their
                // role (with a colour cue) regardless of tier.
                (() => {
                  const meta = ROLE_CHIP[accountRole];
                  const Icon = meta.icon;
                  return (
                    <span
                      className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
                    >
                      <Icon className="size-3" />
                      {t(meta.labelKey as string)}
                    </span>
                  );
                })()
              ) : null}
            </div>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              title={profile?.full_name ?? profile?.email ?? t("defaultUser")}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-sidebar-accent focus:bg-sidebar-accent focus:outline-none data-popup-open:bg-sidebar-accent lg:justify-center lg:px-0"
            >
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? t("defaultAvatar")}
                  />
                ) : null}
                <AvatarFallback className="bg-sidebar-primary/20 text-sm font-medium text-sidebar-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 lg:hidden">
                <p className="truncate text-sm font-medium text-sidebar-foreground">
                  {profile?.full_name ?? t("defaultUser")}
                </p>
                <p className="truncate text-xs text-sidebar-foreground/60">
                  {profile?.email ?? ""}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 bg-popover text-popover-foreground ring-border"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                {t("menuProfile")}
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=whatsapp"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <Settings className="size-4" />
                {t("menuSettings")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <LogOut className="size-4" />
                {t("menuSignOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
