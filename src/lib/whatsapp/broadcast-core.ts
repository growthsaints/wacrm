// ============================================================
// Public-API broadcast core.
//
// Splits a broadcast into two phases so the HTTP route can persist +
// acknowledge fast and fan out afterwards (in `after()`):
//
//   createBroadcast()  — validate, resolve contacts, insert the
//                        `broadcasts` row + `broadcast_recipients`
//                        rows (status 'pending'), return a plan.
//   deliverBroadcast() — send each recipient's template via Meta
//                        (phone-variant retry), stamp each recipient
//                        row + the aggregate counts, finalize status.
//
// Recipient rows carry `whatsapp_message_id`, so the inbound webhook's
// status handler (which matches on that column) updates delivered/read
// for API broadcasts exactly as it does for dashboard ones.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import type { MessageTemplate } from '@/types';
import { findOrCreateContact } from '@/lib/api/v1/contacts';
import { categoryFromTemplate } from '@/lib/billing/rates';
import { ensureWalletBalance, chargeWalletForSend, WalletError } from '@/lib/billing/wallet';
import { ensureDailyBroadcastQuota, DailyQuotaError } from '@/lib/whatsapp/daily-quota';
import { ensureQualityRatingSafe, QualityRatingError } from '@/lib/whatsapp/quality-guard';
import { shouldTestBatchFirst, TEST_BATCH_SIZE } from '@/lib/whatsapp/test-batch';

/** Thrown by createBroadcast on a caller-visible failure; route maps it. */
export class BroadcastError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'BroadcastError';
    this.code = code;
    this.status = status;
  }
}

export interface BroadcastRecipientInput {
  /** E.164 phone. */
  to: string;
  /** Positional body params for the template ({{1}}, {{2}}…). */
  params?: string[];
}

export interface CreateBroadcastParams {
  name?: string | null;
  templateName: string;
  templateLanguage?: string | null;
  recipients: BroadcastRecipientInput[];
}

interface PlannedRecipient {
  recipientRowId: string;
  phone: string;
  params: string[];
}

export interface BroadcastPlan {
  broadcastId: string;
  accountId: string;
  templateName: string;
  templateLanguage: string;
  phoneNumberId: string;
  accessToken: string;
  templateRow: MessageTemplate | null;
  planned: PlannedRecipient[];
  /** Phones rejected up front (invalid E.164) — counted as failed. */
  rejected: number;
  /**
   * True when the audience is large enough to send a test batch first
   * (see lib/whatsapp/test-batch.ts) — deliverBroadcast only sends to
   * the first TEST_BATCH_SIZE of `planned` and leaves the broadcast at
   * `awaiting_confirmation`; resumeBroadcastDelivery sends the rest.
   */
  isLargeBroadcast: boolean;
}

const MAX_RECIPIENTS = 1000;

/**
 * Validate + persist a broadcast, resolving each recipient to a
 * contact. Returns a plan for {@link deliverBroadcast}. Throws
 * {@link BroadcastError} on bad input / missing config / a malformed
 * template / a DB failure — nothing is sent in this phase.
 */
export async function createBroadcast(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  params: CreateBroadcastParams
): Promise<BroadcastPlan> {
  const { name, templateName, recipients } = params;
  const templateLanguage = params.templateLanguage || 'en_US';

  if (!templateName) {
    throw new BroadcastError('bad_request', "'template_name' is required", 400);
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new BroadcastError(
      'bad_request',
      "'recipients' must be a non-empty array of { to, params? }",
      400
    );
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw new BroadcastError(
      'bad_request',
      `A broadcast is capped at ${MAX_RECIPIENTS} recipients per request; split larger sends`,
      400
    );
  }

  // Config (fail fast + provides the audit trail owner already resolved
  // by the caller). Meta send needs phone_number_id + decrypted token.
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();
  if (configError || !config) {
    throw new BroadcastError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }
  const accessToken = decrypt(config.access_token);

  // Template row (once) for header/button components; guard a
  // malformed local row rather than N identical opaque failures.
  const { data: rawTemplateRow } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', templateName)
    .eq('language', templateLanguage)
    .maybeSingle();
  if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
    throw new BroadcastError(
      'template_malformed',
      'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
      500
    );
  }
  const templateRow = (rawTemplateRow as MessageTemplate | null) ?? null;

  // Resolve each recipient to a contact. Invalid phones are dropped
  // (counted as rejected) rather than aborting the whole broadcast.
  const resolved: { contactId: string; phone: string; params: string[] }[] = [];
  let rejected = 0;
  for (const r of recipients) {
    const sanitized = sanitizePhoneForMeta(typeof r.to === 'string' ? r.to : '');
    if (!isValidE164(sanitized)) {
      rejected++;
      continue;
    }
    const { id } = await findOrCreateContact(db, accountId, auditUserId, {
      phone: sanitized,
    });
    resolved.push({
      contactId: id,
      phone: sanitized,
      params: Array.isArray(r.params)
        ? r.params.filter((p): p is string => typeof p === 'string')
        : [],
    });
  }

  // Collapse recipients that resolved to the SAME contact (the caller
  // listed a phone twice, or two numbers fuzzy-matched to one contact).
  // Keep the first occurrence so the contact is messaged once and its
  // params aren't silently overwritten by a later duplicate — and so
  // the row↔params pairing below (keyed by contact_id) is unambiguous.
  const seenContact = new Set<string>();
  const deduped = resolved.filter((r) => {
    if (seenContact.has(r.contactId)) return false;
    seenContact.add(r.contactId);
    return true;
  });

  if (deduped.length === 0) {
    throw new BroadcastError(
      'bad_request',
      'No recipients had a valid E.164 phone number',
      400
    );
  }

  // Persist the broadcast + its recipients. The count columns
  // (sent/delivered/read/replied/failed) are owned by the DB aggregate
  // trigger (migrations 003/005) and derived purely from
  // broadcast_recipients rows — we deliberately do NOT seed them here
  // (a manual value would be clobbered by the trigger on the first
  // recipient change). `rejected` phones have no recipient row, so they
  // are reported to the caller in the POST response, not in these
  // persisted counts.
  const { data: broadcast, error: bErr } = await db
    .from('broadcasts')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      name: name || `API broadcast (${templateName})`,
      template_name: templateName,
      template_language: templateLanguage,
      status: 'sending',
      total_recipients: deduped.length,
    })
    .select('id')
    .single();
  if (bErr || !broadcast) {
    console.error('[broadcast-core] create broadcast error:', bErr);
    throw new BroadcastError('internal', 'Failed to create broadcast', 500);
  }

  const { data: recipientRows, error: rErr } = await db
    .from('broadcast_recipients')
    .insert(
      deduped.map((r) => ({
        broadcast_id: broadcast.id,
        contact_id: r.contactId,
        status: 'pending' as const,
        // Persisted so a later resumeBroadcastDelivery (confirming a
        // test batch, or recovering a broadcast that never finished)
        // can re-send with the same personalization — params only ever
        // existed in-memory here otherwise.
        send_params: r.params,
      }))
    )
    .select('id, contact_id');
  if (rErr || !recipientRows) {
    console.error('[broadcast-core] create recipients error:', rErr);
    throw new BroadcastError('internal', 'Failed to create broadcast', 500);
  }

  // Pair each inserted recipient row back to its phone/params by
  // contact_id — unambiguous now that duplicates are collapsed.
  const byContact = new Map(deduped.map((r) => [r.contactId, r]));
  const planned: PlannedRecipient[] = recipientRows.map((row) => {
    const r = byContact.get(row.contact_id as string)!;
    return { recipientRowId: row.id as string, phone: r.phone, params: r.params };
  });

  return {
    broadcastId: broadcast.id,
    accountId,
    templateName,
    templateLanguage,
    phoneNumberId: config.phone_number_id,
    accessToken,
    templateRow,
    planned,
    rejected,
    isLargeBroadcast: shouldTestBatchFirst(deduped.length),
  };
}

interface SendPlannedRecipientsParams {
  accountId: string;
  templateName: string;
  templateLanguage: string;
  phoneNumberId: string;
  accessToken: string;
  templateRow: MessageTemplate | null;
  planned: PlannedRecipient[];
}

/**
 * The actual per-recipient send loop: phone-variant retry, wallet/daily-
 * quota/quality-rating guards, and the `broadcast_recipients` row
 * update. Best-effort per recipient — one failure never aborts the
 * rest. Shared by {@link deliverBroadcast} (the initial send) and
 * {@link resumeBroadcastDelivery} (confirming a test batch, or
 * recovering a broadcast that never finished) so both apply the exact
 * same protections rather than a second, drifting copy.
 */
async function sendPlannedRecipients(
  db: SupabaseClient,
  params: SendPlannedRecipientsParams
): Promise<{ sentCount: number }> {
  const { accountId, templateName, templateLanguage, phoneNumberId, accessToken, templateRow, planned } =
    params;
  let sentCount = 0;
  const billingCategory = categoryFromTemplate(templateRow?.category);

  for (const recipient of planned) {
    // Checked first and per-recipient: a Red quality rating can be hit
    // mid-broadcast (Meta re-scores continuously), so re-checking on
    // every recipient — not once up front — stops the send the moment
    // it happens instead of finishing out a batch that's actively
    // making the number's standing worse.
    try {
      await ensureQualityRatingSafe(db, accountId);
    } catch (err) {
      const message = err instanceof QualityRatingError ? err.message : 'Quality rating check failed';
      await db
        .from('broadcast_recipients')
        .update({ status: 'failed', error_message: message })
        .eq('id', recipient.recipientRowId);
      continue;
    }

    // Checked per-recipient (not once for the whole broadcast) so a
    // wallet that runs out partway through stops billing further sends
    // instead of either over-charging or crashing the whole batch.
    try {
      await ensureWalletBalance(db, accountId, billingCategory);
    } catch (err) {
      const message = err instanceof WalletError ? err.message : 'Wallet check failed';
      await db
        .from('broadcast_recipients')
        .update({ status: 'failed', error_message: message })
        .eq('id', recipient.recipientRowId);
      continue;
    }

    // Same per-recipient reasoning as the wallet check above — stops
    // sending the moment the account hits its Meta messaging-limit
    // tier's daily cap, rather than plowing through the rest of the
    // batch and risking Meta throttling/flagging the number.
    try {
      await ensureDailyBroadcastQuota(db, accountId);
    } catch (err) {
      const message = err instanceof DailyQuotaError ? err.message : 'Daily quota check failed';
      await db
        .from('broadcast_recipients')
        .update({ status: 'failed', error_message: message })
        .eq('id', recipient.recipientRowId);
      continue;
    }

    const variants = phoneVariants(recipient.phone);
    let sentMessageId: string | null = null;
    let lastError: string | null = null;

    for (const variant of variants) {
      try {
        const result = await sendTemplateMessage({
          phoneNumberId,
          accessToken,
          to: variant,
          templateName,
          language: templateLanguage,
          template: templateRow ?? undefined,
          params: recipient.params,
        });
        sentMessageId = result.messageId;
        lastError = null;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        lastError = message;
        // Only a "recipient not allowed" error is worth another variant.
        if (!isRecipientNotAllowedError(message)) break;
      }
    }

    if (sentMessageId) {
      sentCount++;
      await chargeWalletForSend(db, accountId, billingCategory);
      await db
        .from('broadcast_recipients')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          whatsapp_message_id: sentMessageId,
          error_message: null,
        })
        .eq('id', recipient.recipientRowId);
    } else {
      await db
        .from('broadcast_recipients')
        .update({
          status: 'failed',
          error_message: lastError || 'Unknown error',
        })
        .eq('id', recipient.recipientRowId);
    }
  }

  return { sentCount };
}

/**
 * Fan out a {@link BroadcastPlan}. Designed to run inside `after()`.
 *
 * For a large audience (`plan.isLargeBroadcast`), only the first
 * `TEST_BATCH_SIZE` of `plan.planned` are actually sent here — the rest
 * stay `pending` and the broadcast lands at `awaiting_confirmation`
 * rather than `sent`/`failed`, so a bad template/audience is caught
 * while only a handful of contacts have been messaged. See
 * {@link resumeBroadcastDelivery} for sending the remainder once
 * confirmed.
 *
 * The per-status count columns on `broadcasts` are owned by the DB
 * aggregate trigger (migrations 003/005): each recipient-row update
 * advances them automatically, and later Meta delivery/read webhooks
 * keep advancing them. We therefore never write those columns here —
 * only the terminal `status` — otherwise a manual value would race and
 * clobber the trigger-maintained counts.
 */
export async function deliverBroadcast(
  db: SupabaseClient,
  plan: BroadcastPlan
): Promise<void> {
  const toSend = plan.isLargeBroadcast ? plan.planned.slice(0, TEST_BATCH_SIZE) : plan.planned;

  const { sentCount } = await sendPlannedRecipients(db, {
    accountId: plan.accountId,
    templateName: plan.templateName,
    templateLanguage: plan.templateLanguage,
    phoneNumberId: plan.phoneNumberId,
    accessToken: plan.accessToken,
    templateRow: plan.templateRow,
    planned: toSend,
  });

  // Terminal status only — counts are trigger-owned (see the note
  // above). If nothing sent, the broadcast failed outright; a partial
  // send of a normal-size broadcast is still 'sent' (per-recipient
  // failures show in failed_count) — but a large broadcast's test batch
  // lands at 'awaiting_confirmation' instead, pending a human decision
  // to send the rest via resumeBroadcastDelivery.
  const finalStatus =
    sentCount === 0 ? 'failed' : plan.isLargeBroadcast ? 'awaiting_confirmation' : 'sent';
  await db
    .from('broadcasts')
    .update({
      status: finalStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', plan.broadcastId);
}

/**
 * Confirms and sends the remainder of a broadcast a test batch left at
 * `awaiting_confirmation` (see {@link deliverBroadcast}) — the public-
 * API counterpart of the dashboard's `resumeBroadcast()` client hook,
 * which does the equivalent for a dashboard-created broadcast via
 * `/api/whatsapp/broadcast`. Also doubles as recovery for a broadcast
 * whose delivery was interrupted (e.g. a serverless function frozen
 * mid-`after()`), since both cases are just "recipients still pending".
 *
 * Rejects any status other than `awaiting_confirmation` so this can't
 * be used to re-fire a broadcast that already finished sending.
 */
export async function resumeBroadcastDelivery(
  db: SupabaseClient,
  accountId: string,
  broadcastId: string
): Promise<{ sent: number; failed: number; status: 'sent' | 'failed' }> {
  const { data: broadcast, error: bErr } = await db
    .from('broadcasts')
    .select('id, status, template_name, template_language')
    .eq('id', broadcastId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (bErr || !broadcast) {
    throw new BroadcastError('not_found', 'Broadcast not found', 404);
  }
  if (broadcast.status !== 'awaiting_confirmation') {
    throw new BroadcastError(
      'bad_request',
      `Broadcast is '${broadcast.status}', not awaiting confirmation — nothing to confirm.`,
      400
    );
  }

  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle();
  if (configError || !config) {
    throw new BroadcastError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }
  const accessToken = decrypt(config.access_token);

  const { data: rawTemplateRow } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', broadcast.template_name)
    .eq('language', broadcast.template_language)
    .maybeSingle();
  const templateRow =
    rawTemplateRow && isMessageTemplate(rawTemplateRow) ? (rawTemplateRow as MessageTemplate) : null;

  const { data: pendingRows, error: pendingError } = await db
    .from('broadcast_recipients')
    .select('id, send_params, contact:contacts(phone)')
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending');
  if (pendingError) {
    throw new BroadcastError('internal', 'Failed to load pending recipients', 500);
  }

  const planned: PlannedRecipient[] = ((pendingRows ?? []) as unknown as Array<{
    id: string;
    send_params: unknown;
    contact: { phone?: string } | null;
  }>)
    .filter((row) => Boolean(row.contact?.phone))
    .map((row) => ({
      recipientRowId: row.id,
      phone: row.contact!.phone as string,
      params: Array.isArray(row.send_params) ? (row.send_params as string[]) : [],
    }));

  if (planned.length === 0) {
    throw new BroadcastError('bad_request', 'No pending recipients left to confirm.', 400);
  }

  const { sentCount } = await sendPlannedRecipients(db, {
    accountId,
    templateName: broadcast.template_name,
    templateLanguage: broadcast.template_language,
    phoneNumberId: config.phone_number_id,
    accessToken,
    templateRow,
    planned,
  });

  const status: 'sent' | 'failed' = sentCount === 0 ? 'failed' : 'sent';
  await db
    .from('broadcasts')
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', broadcastId);

  return { sent: sentCount, failed: planned.length - sentCount, status };
}
