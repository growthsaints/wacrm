"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface WhatsAppAccountAlert {
  id: string;
  field: string;
  created_at: string;
}

/**
 * Most recent unresolved, flagged Meta account-level webhook event for
 * the signed-in user's account (account_review_update, account_alerts,
 * phone_number_quality_update, etc. whose raw payload matched a
 * ban/restrict/disable/flag/violat keyword — see logAccountLevelEvent
 * in the webhook route). RLS requires admin+ to read
 * whatsapp_account_events, so `enabled` should be the caller's own
 * canEditSettings check — this silently returns null rather than
 * erroring for lower roles.
 *
 * Deliberately doesn't try to say *what* happened beyond "Meta sent
 * something concerning" — Meta's exact payload shape for an actual
 * ban isn't something the webhook handler parses with confidence (see
 * its own comment), so this only surfaces the fact of the event and
 * points the owner at Meta's own tools to confirm the real cause.
 * Clears once a platform admin marks the row resolved.
 */
export function useWhatsAppAccountAlert(
  enabled: boolean,
): WhatsAppAccountAlert | null {
  const [alert, setAlert] = useState<WhatsAppAccountAlert | null>(null);

  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting on a role/account change, same pattern used elsewhere (deal-form.tsx, custom-fields-manager.tsx)
      setAlert(null);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("whatsapp_account_events")
      .select("id, field, created_at")
      .eq("flagged", true)
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(
        ({
          data,
          error,
        }: {
          data: WhatsAppAccountAlert | null;
          error: unknown;
        }) => {
          if (!cancelled && !error) setAlert(data ?? null);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return alert;
}
