'use client';

// ============================================================
// GettingStartedSection — wraps the "how do I…" tips carousel
// (DashboardGuideCarousel) and the WhatsApp setup checklist behind
// one collapsible card at the bottom of the dashboard. The
// feature/guide image slider lives up in the page header instead (see
// dashboard/page.tsx) — it fills the gap beside the wallet/WhatsApp
// status cards rather than duplicating here.
//
// Previously these rendered unconditionally at the very top of the
// page, ahead of every live metric/chart — so a returning user with
// an already-connected account saw the same onboarding content above
// the data they actually opened the dashboard for, on every visit.
// Collapsing it (and moving it below the real analytics) keeps it one
// click away for someone who does want it, without permanently
// costing everyone else the top of the page.
//
// Expand/collapse state persists per-browser via localStorage, same
// pattern as flow-editor-shell's view-mode toggle — defaults to
// collapsed so an established account's dashboard opens straight into
// its data.
// ============================================================

import { useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DashboardGuideCarousel } from './dashboard-guide-carousel';
import { WhatsAppOnboardingChecklist } from './whatsapp-onboarding-checklist';

const STORAGE_KEY = 'dashboard-getting-started-expanded';

export function GettingStartedSection() {
  const [expanded, setExpanded] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Private browsing / disabled storage — the toggle still works
      // for this session, it just won't be remembered next visit.
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles className="size-4 text-primary" />
          Getting Started &amp; Tips
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded ? (
        <div className="grid grid-cols-1 gap-4 border-t border-border p-4 lg:grid-cols-2">
          <DashboardGuideCarousel />
          <WhatsAppOnboardingChecklist />
        </div>
      ) : null}
    </div>
  );
}
