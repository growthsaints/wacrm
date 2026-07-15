'use client';

import { useEffect, useState } from 'react';
import {
  BadgeCheck,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  UserCog,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { ConnectWhatsAppButton } from '@/components/whatsapp/connect-whatsapp-button';
import { EditProfileDialog } from '@/components/whatsapp/edit-profile-dialog';

const META_BUSINESS_VERIFICATION_URL =
  'https://www.facebook.com/business/help/2058515011254025';
const META_OFFICIAL_BUSINESS_ACCOUNT_URL =
  'https://www.facebook.com/business/help/2054875584716251';

function StepBadge({ done }: { done: boolean }) {
  if (!done) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="size-3" /> Done
    </span>
  );
}

/**
 * "Setup FREE WhatsApp Business Account" — an AiSensy-style onboarding
 * checklist. Step 1 is real (mirrors the actual Embedded Signup
 * connection state). Steps 2 and 4 are guidance-only: Meta owns
 * business verification and Official Business Account approval end to
 * end, and exposes no API for a third party to check or trigger either
 * — so they're informational rather than a fake automated checkmark.
 */
export function WhatsAppOnboardingChecklist() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('account_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!profile?.account_id) return;
      const { data } = await supabase
        .from('whatsapp_config')
        .select('status')
        .eq('account_id', profile.account_id)
        .maybeSingle();
      if (!cancelled) setConnected(data?.status === 'connected');
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">
          Setup Your WhatsApp Business Account
        </p>
      </div>

      <Accordion defaultValue={['step-1']}>
        <AccordionItem value="step-1">
          <AccordionTrigger>
            <span className="flex items-center gap-2 text-sm font-medium">
              1. Apply for WhatsApp Business API
              <StepBadge done={connected === true} />
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <p className="mb-3 text-sm text-muted-foreground">
              Connect your WhatsApp Business Account via Meta — this configures
              everything automatically.
            </p>
            {connected ? (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">
                Your WhatsApp number is connected.
              </p>
            ) : (
              <ConnectWhatsAppButton onConnected={() => setConnected(true)} />
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="step-2">
          <AccordionTrigger>
            <span className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-4 text-primary" />
              2. Increase your messaging limit &amp; get your display name approved
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <p className="mb-2 text-sm text-muted-foreground">
              Complete your business verification with Meta to boost your
              messaging limit to 2,000/day and get your display name approved.
            </p>
            <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Your Legal/Trade Name on your GST certificate and Meta Business Manager should match.</li>
              <li>Have an active website before applying for verification.</li>
              <li>Use the director&apos;s Aadhaar card listed on your GST document.</li>
            </ul>
            <a
              href={META_BUSINESS_VERIFICATION_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80"
            >
              Meta&apos;s business verification guide <ExternalLink className="size-3.5" />
            </a>
            <p className="mt-2 text-xs text-muted-foreground">
              This happens entirely in Meta Business Manager — we can&apos;t check
              or complete it on your behalf.
            </p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="step-3">
          <AccordionTrigger>
            <span className="flex items-center gap-2 text-sm font-medium">
              <UserCog className="size-4 text-primary" />
              3. Setup your WhatsApp profile
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <p className="mb-3 text-sm text-muted-foreground">
              Customize your WhatsApp profile — about, description, category,
              address, and photo — so customers know who they&apos;re chatting with.
            </p>
            <Button variant="outline" onClick={() => setEditProfileOpen(true)}>
              Edit Profile
            </Button>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="step-4">
          <AccordionTrigger>
            <span className="flex items-center gap-2 text-sm font-medium">
              <BadgeCheck className="size-4 text-primary" />
              4. Apply for the green tick (Official Business Account)
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <p className="mb-2 text-sm text-muted-foreground">
              Once your business is verified, you can apply directly with Meta
              for Official Business Account status — the checkmark badge shown
              next to your business name in WhatsApp.
            </p>
            <a
              href={META_OFFICIAL_BUSINESS_ACCOUNT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80"
            >
              How to apply with Meta <ExternalLink className="size-3.5" />
            </a>
            <p className="mt-2 text-xs text-muted-foreground">
              This is a manual application reviewed and approved by Meta —
              there&apos;s no API for us to submit or track it for you.
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <EditProfileDialog open={editProfileOpen} onOpenChange={setEditProfileOpen} />
    </div>
  );
}
