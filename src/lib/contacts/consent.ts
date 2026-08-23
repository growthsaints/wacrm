// ============================================================
// WhatsApp opt-in consent tracking (migration 070) — resolves a
// customer's QUICK_REPLY button tap on a consent-request template
// into a `contact_consent` status update.
//
// Called from the webhook's `case 'button':` handling, right next to
// the existing `handleOptOutKeyword` (STOP/UNSUBSCRIBE text replies —
// migration 062). Same posture: best-effort, never throws, so a
// malformed/unexpected payload can't break message ingestion.
//
// Sending the initial consent-request template (setting a row to
// `pending` / `consent_template_sent_at`) is a separate concern (e.g.
// triggered from CSV import) — this module only resolves the
// customer's response.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';

export const CONSENT_YES_PAYLOAD = 'YES_CONSENT';
export const CONSENT_NO_PAYLOAD = 'NO_CONSENT';

/** Maps a button payload to the resulting consent_status, or null if it isn't a consent button at all. */
export function resolveConsentStatus(
  payload: string
): 'opted_in' | 'opted_out' | null {
  if (payload === CONSENT_YES_PAYLOAD) return 'opted_in';
  if (payload === CONSENT_NO_PAYLOAD) return 'opted_out';
  return null;
}

/**
 * Record a customer's response to a consent-request template.
 * No-op (not an error) if `payload` isn't a recognized consent button,
 * or if no pending `contact_consent` row exists for this phone — the
 * customer may have tapped a completely unrelated template button.
 *
 * On `opted_out`, also flips `contacts.marketing_opt_out` so the
 * existing broadcast-audience exclusion (migration 062) honors it
 * immediately — one authoritative "can we message this contact"
 * signal, not two that can drift out of sync.
 */
export async function recordConsentResponse(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  phone: string,
  payload: string
): Promise<void> {
  const status = resolveConsentStatus(payload);
  if (!status) return;

  try {
    const sanitizedPhone = sanitizePhoneForMeta(phone);

    const { data: updated, error } = await db
      .from('contact_consent')
      .update({
        consent_status: status,
        consent_responded_at: new Date().toISOString(),
        consent_response_payload: payload,
        contact_id: contactId,
      })
      .eq('account_id', accountId)
      .eq('phone_number', sanitizedPhone)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[consent] response update failed:', error.message);
      return;
    }
    // No pending row for this number — nothing to resolve. Not an
    // error: the tapped button just wasn't a consent request.
    if (!updated) return;

    if (status === 'opted_out') {
      const { error: optOutError } = await db
        .from('contacts')
        .update({
          marketing_opt_out: true,
          opted_out_at: new Date().toISOString(),
        })
        .eq('id', contactId);
      if (optOutError) {
        console.error(
          '[consent] marketing_opt_out sync failed:',
          optOutError.message
        );
      }
    }
  } catch (err) {
    console.error('[consent] recordConsentResponse failed:', err);
  }
}

/** Postgres unique_violation — see the no-op note below. */
const UNIQUE_VIOLATION = '23505';

/**
 * Record implicit consent for a contact whose FIRST-EVER interaction
 * with the business was messaging us on WhatsApp themselves — no
 * consent-request template is needed for this source, since they
 * initiated the conversation, not us.
 *
 * Insert-and-ignore-conflict (not check-then-insert, matching the
 * codebase's usual dedupe pattern): if a `contact_consent` row
 * already exists for this number (tracked from a CSV import, manual
 * add, or the public API — i.e. the business tried to reach them
 * first, at some point, under a different status), this is a no-op —
 * an inbound message must never silently overwrite an existing
 * tracked consent status (e.g. a prior explicit opt-out).
 *
 * Call this only when the inbound message is genuinely the contact's
 * first ever (see the webhook's `isFirstInboundMessage`) — not on
 * every message.
 */
export async function recordImplicitConsentFromInboundMessage(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  phone: string
): Promise<void> {
  try {
    const sanitizedPhone = sanitizePhoneForMeta(phone);
    const { error } = await db.from('contact_consent').insert({
      account_id: accountId,
      contact_id: contactId,
      phone_number: sanitizedPhone,
      source: 'whatsapp_inbound',
      consent_status: 'opted_in',
    });
    if (error && error.code !== UNIQUE_VIOLATION) {
      console.error(
        '[consent] implicit inbound consent insert failed:',
        error.message
      );
    }
  } catch (err) {
    console.error(
      '[consent] recordImplicitConsentFromInboundMessage failed:',
      err
    );
  }
}
