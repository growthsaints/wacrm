'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

function PlanIllustration() {
  return (
    <svg viewBox="0 0 200 140" className="h-28 w-auto" fill="none">
      <rect x="8" y="20" width="52" height="92" rx="10" className="fill-card-2 stroke-border" strokeWidth="1.5" />
      <rect x="74" y="8" width="52" height="104" rx="10" className="fill-primary/10 stroke-primary" strokeWidth="2" />
      <rect x="140" y="20" width="52" height="92" rx="10" className="fill-card-2 stroke-border" strokeWidth="1.5" />
      <rect x="86" y="20" width="28" height="6" rx="3" className="fill-primary" />
      <rect x="86" y="34" width="20" height="14" rx="4" className="fill-primary/70" />
      <rect x="86" y="56" width="26" height="4" rx="2" className="fill-primary/40" />
      <rect x="86" y="66" width="20" height="4" rx="2" className="fill-primary/40" />
      <rect x="86" y="76" width="24" height="4" rx="2" className="fill-primary/40" />
      <rect x="86" y="92" width="28" height="14" rx="7" className="fill-primary" />
      <circle cx="34" cy="46" r="10" className="fill-muted" />
      <circle cx="166" cy="46" r="10" className="fill-muted" />
    </svg>
  );
}

function RechargeIllustration() {
  return (
    <svg viewBox="0 0 200 140" className="h-28 w-auto" fill="none">
      <rect x="24" y="34" width="152" height="88" rx="14" className="fill-card-2 stroke-border" strokeWidth="1.5" />
      <rect x="24" y="34" width="152" height="26" rx="14" className="fill-primary" />
      <circle cx="150" cy="90" r="20" className="fill-primary/15 stroke-primary" strokeWidth="1.5" />
      <path d="M150 80v20M141 90h18" className="stroke-primary" strokeWidth="3" strokeLinecap="round" />
      <rect x="40" y="78" width="48" height="8" rx="4" className="fill-muted-foreground/30" />
      <rect x="40" y="94" width="34" height="8" rx="4" className="fill-muted-foreground/20" />
      <path d="M8 20l14 8-14 8V20z" className="fill-primary/50" />
      <path d="M192 100l-14-8 14-8v16z" className="fill-primary/50" />
    </svg>
  );
}

function ConnectIllustration() {
  return (
    <svg viewBox="0 0 200 140" className="h-28 w-auto" fill="none">
      <circle cx="46" cy="70" r="34" className="fill-[#1877F2]/10 stroke-[#1877F2]" strokeWidth="2" />
      <path
        d="M54 55h-6c-4 0-6 2-6 6v6h-6l1 8h5v20h8V75h6l1-8h-7v-4c0-2 1-3 3-3h4v-9z"
        className="fill-[#1877F2]"
      />
      <circle cx="154" cy="70" r="34" className="fill-primary/10 stroke-primary" strokeWidth="2" />
      <path
        d="M154 50a20 20 0 0 0-17 30.5l-2.3 8.4 8.6-2.3A20 20 0 1 0 154 50z"
        className="fill-primary"
      />
      <circle cx="146" cy="70" r="2.2" className="fill-card" />
      <circle cx="154" cy="70" r="2.2" className="fill-card" />
      <circle cx="162" cy="70" r="2.2" className="fill-card" />
      <path
        d="M80 70h40"
        className="stroke-muted-foreground/50"
        strokeWidth="2.5"
        strokeDasharray="5 5"
      />
      <path d="M112 62l8 8-8 8" className="stroke-muted-foreground/50" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface Slide {
  Illustration: () => React.ReactElement;
  title: string;
  description: string;
}

const SLIDES: Slide[] = [
  {
    Illustration: PlanIllustration,
    title: 'Choose a plan & pay',
    description:
      'Go to Settings → Billing to see the Monthly, Quarterly, or Managed plans. Pick one, complete checkout, and your plan activates immediately — see the renewal date right there too.',
  },
  {
    Illustration: RechargeIllustration,
    title: 'Recharge your wallet',
    description:
      'WhatsApp messaging is billed from a prepaid wallet, separate from your plan. In Settings → Billing, click Recharge, choose an amount, and pay by card or UPI — your balance updates right away.',
  },
  {
    Illustration: ConnectIllustration,
    title: 'Connect WhatsApp via Facebook',
    description:
      'In Settings → WhatsApp, click "Continue with Facebook" and follow the guided popup — it links your WhatsApp Business number and configures everything automatically. No manual setup needed.',
  },
];

/**
 * A small, purely informational carousel — "how do I…" guidance for
 * the three things new users ask about most (plans/payment, wallet
 * recharge, connecting WhatsApp). Auto-advances every 6s, pauses while
 * the user is looking at a specific slide via the arrows/dots.
 */
export function DashboardGuideCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), 6000);
    return () => clearInterval(id);
  }, [paused]);

  const slide = SLIDES[index];

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-border bg-card p-4"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-center gap-4">
        <div className="flex shrink-0 items-center justify-center">
          <slide.Illustration />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{slide.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{slide.description}</p>
        </div>
        <div className="hidden shrink-0 flex-col gap-1 sm:flex">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIndex((i) => (i - 1 + SLIDES.length) % SLIDES.length)}
            aria-label="Previous"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIndex((i) => (i + 1) % SLIDES.length)}
            aria-label="Next"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-center gap-1.5">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Go to slide ${i + 1}`}
            className={`h-1.5 rounded-full transition-all ${
              i === index ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
