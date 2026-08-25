'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { Contact } from '@/types';

export type SmsCustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface SmsCustomFieldFilter {
  fieldId: string;
  operator: SmsCustomFieldOperator;
  value: string;
}

export interface SmsAudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  customField?: SmsCustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
}

interface CreateSmsBroadcastParams {
  name: string;
  body: string;
  audience: SmsAudienceConfig;
}

interface UseSmsBroadcastReturn {
  createAndSendSmsBroadcast: (params: CreateSmsBroadcastParams) => Promise<string>;
  retryFailedSmsBroadcast: (broadcastId: string) => Promise<void>;
  isProcessing: boolean;
  progress: number;
}

/**
 * Same pacing as the WhatsApp broadcast hook (use-broadcast-sending.ts)
 * — 10 per batch + 1s pause. There's no published rate limit for the
 * SMS Gateway app/cloud relay, so this reuses the WhatsApp-broadcast
 * default as a conservative, already-proven-safe starting point rather
 * than guessing a more aggressive number.
 */
const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;
const CHUNK_SIZE = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Positional {{name}} substitution only — SMS broadcasts are plain text, no template variable system. */
function personalize(body: string, contact: Contact): string {
  return body.replaceAll('{{name}}', contact.name || contact.phone);
}

interface SmsSendLoopRecipient {
  id: string;
  contact: Contact;
}

/**
 * The actual per-recipient send loop — batches of SEND_BATCH_SIZE,
 * paced by SEND_BATCH_DELAY_MS. Shared by the initial send
 * (createAndSendSmsBroadcast) and retrying failed recipients
 * (retryFailedSmsBroadcast). A recipient whose conversation was never
 * created (the old per-user-rate-limit bug meant many failures never
 * got that far) always gets freshly round-robin-assigned on retry.
 * A recipient with an *existing* conversation stays pinned to its
 * original device UNLESS isRetry is set — passed through to
 * /api/sms/broadcast-send as is_retry, which allows
 * sendSmsToConversation to re-pin to a different device if the
 * original one is at its daily cap (see lib/sms/send-message.ts).
 * That reassignment is retry-only: an interactive reply must keep
 * using whatever device the customer already saw.
 */
async function runSmsSendLoop(
  supabase: ReturnType<typeof createClient>,
  recipients: SmsSendLoopRecipient[],
  bodyText: string,
  onProgress: (pct: number) => void,
  isRetry = false,
): Promise<{ sentCount: number; failedCount: number }> {
  let sentCount = 0;
  let failedCount = 0;
  const total = recipients.length || 1;

  for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
    const batch = recipients.slice(i, i + SEND_BATCH_SIZE);

    await Promise.all(
      batch.map(async ({ id, contact }) => {
        try {
          const res = await fetch('/api/sms/broadcast-send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contact_id: contact.id,
              content_text: personalize(bodyText, contact),
              is_retry: isRetry,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            failedCount++;
            await supabase
              .from('sms_broadcast_recipients')
              .update({ status: 'failed', error_message: data.error || `HTTP ${res.status}` })
              .eq('id', id);
            return;
          }
          sentCount++;
          await supabase
            .from('sms_broadcast_recipients')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              error_message: null,
              sms_config_id: data.sms_config_id ?? null,
            })
            .eq('id', id);
        } catch (err) {
          failedCount++;
          await supabase
            .from('sms_broadcast_recipients')
            .update({
              status: 'failed',
              error_message: err instanceof Error ? err.message : 'Unknown error',
            })
            .eq('id', id);
        }
      }),
    );

    onProgress(Math.round(((i + batch.length) / total) * 100));
    if (i + SEND_BATCH_SIZE < recipients.length) {
      await sleep(SEND_BATCH_DELAY_MS);
    }
  }

  return { sentCount, failedCount };
}

async function fetchContactsByIds(
  supabase: ReturnType<typeof createClient>,
  ids: string[],
): Promise<Contact[]> {
  const contacts: Contact[] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .in('id', ids.slice(i, i + CHUNK_SIZE));
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    contacts.push(...((data ?? []) as Contact[]));
  }
  return contacts;
}

export function useSmsBroadcast(): UseSmsBroadcastReturn {
  const { accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function resolveCustomFieldAudience(
    supabase: ReturnType<typeof createClient>,
    filter: SmsCustomFieldFilter,
  ): Promise<Contact[]> {
    const { fieldId, operator, value } = filter;
    let query = supabase
      .from('contact_custom_values')
      .select('contact_id')
      .eq('custom_field_id', fieldId);
    if (operator === 'is') query = query.eq('value', value);
    else if (operator === 'is_not') query = query.neq('value', value);
    else query = query.ilike('value', `%${value}%`);

    const { data: matches, error: matchErr } = await query;
    if (matchErr) throw new Error(`Custom-field filter failed: ${matchErr.message}`);

    const contactIds = [...new Set((matches ?? []).map((m) => m.contact_id))];
    if (contactIds.length === 0) return [];
    return fetchContactsByIds(supabase, contactIds);
  }

  /**
   * CSV rows arrive as raw phone/name pairs — look up existing contacts
   * by phone, create any that don't exist, return the resolved set.
   * Same shape/behavior as upsertCsvContacts in use-broadcast-sending.ts
   * (kept as a separate copy rather than a shared import — that file is
   * WhatsApp-broadcast-specific and out of scope to touch here).
   */
  async function upsertCsvContacts(
    supabase: ReturnType<typeof createClient>,
    csvRows: { phone: string; name?: string }[],
  ): Promise<Contact[]> {
    if (csvRows.length === 0) return [];
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) throw new Error('You are not signed in.');
    if (!accountId) throw new Error('Your profile is not linked to an account.');

    const uniqueByPhone = new Map<string, { phone: string; name?: string }>();
    for (const row of csvRows) {
      if (row.phone) uniqueByPhone.set(row.phone, row);
    }
    const phones = [...uniqueByPhone.keys()];

    const byPhone = new Map<string, Contact>();
    for (let i = 0; i < phones.length; i += CHUNK_SIZE) {
      const chunk = phones.slice(i, i + CHUNK_SIZE);
      const { data: existing, error: lookupErr } = await supabase
        .from('contacts')
        .select('*')
        .eq('user_id', user.id)
        .in('phone', chunk);
      if (lookupErr) throw new Error(`Failed to look up CSV contacts: ${lookupErr.message}`);
      for (const c of (existing ?? []) as Contact[]) {
        if (c.phone) byPhone.set(c.phone, c);
      }
    }

    const missing = phones
      .filter((p) => !byPhone.has(p))
      .map((phone) => ({
        user_id: user.id,
        account_id: accountId,
        phone,
        name: uniqueByPhone.get(phone)?.name ?? null,
      }));

    for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
      const { data: inserted, error: insertErr } = await supabase
        .from('contacts')
        .insert(missing.slice(i, i + CHUNK_SIZE))
        .select();
      if (insertErr) throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
      for (const c of (inserted ?? []) as Contact[]) {
        if (c.phone) byPhone.set(c.phone, c);
      }
    }

    return phones.map((p) => byPhone.get(p)).filter((c): c is Contact => Boolean(c));
  }

  async function resolveAudience(audience: SmsAudienceConfig): Promise<Contact[]> {
    const supabase = createClient();
    let contacts: Contact[] = [];

    if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
      const { data: contactTags, error: tagError } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', audience.tagIds);
      if (tagError) throw new Error(`Failed to fetch contact tags: ${tagError.message}`);
      const ids = [...new Set((contactTags ?? []).map((ct) => ct.contact_id))];
      contacts = ids.length > 0 ? await fetchContactsByIds(supabase, ids) : [];
    } else if (audience.type === 'custom_field' && audience.customField) {
      contacts = await resolveCustomFieldAudience(supabase, audience.customField);
    } else if (audience.type === 'csv' && audience.csvContacts) {
      contacts = await upsertCsvContacts(supabase, audience.csvContacts);
    } else {
      const { data, error } = await supabase.from('contacts').select('*');
      if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
      contacts = (data ?? []) as Contact[];
    }

    return contacts.filter((c) => !c.marketing_opt_out);
  }

  async function createAndSendSmsBroadcast(params: CreateSmsBroadcastParams): Promise<string> {
    setIsProcessing(true);
    setProgress(0);
    const supabase = createClient();

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('You are not signed in.');
      if (!accountId) throw new Error('Your profile is not linked to an account.');

      setProgress(5);
      const contacts = await resolveAudience(params.audience);
      if (contacts.length === 0) {
        throw new Error('No contacts found for this audience.');
      }

      // Per-device daily caps and device assignment (round-robin new
      // conversations to whichever connected device has the most room
      // left today; existing conversations stick to their own assigned
      // device) are both enforced centrally per-recipient inside
      // sendSmsToConversation, called via /api/sms/broadcast-send below —
      // nothing to pre-check here. A recipient whose device is at cap
      // (or who has none available) simply comes back as a per-recipient
      // failure from that call, same as any other send failure.
      setProgress(15);
      const { data: broadcast, error: broadcastError } = await supabase
        .from('sms_broadcasts')
        .insert({
          account_id: accountId,
          user_id: user.id,
          name: params.name,
          body_text: params.body,
          audience_filter: {
            type: params.audience.type,
            tagIds: params.audience.tagIds,
            customField: params.audience.customField,
          },
          status: 'sending',
          total_recipients: contacts.length,
        })
        .select()
        .single();
      if (broadcastError || !broadcast) {
        throw new Error(`Failed to create SMS broadcast: ${broadcastError?.message ?? 'unknown error'}`);
      }

      setProgress(25);
      const recipientRows = contacts.map((c) => ({
        sms_broadcast_id: broadcast.id,
        contact_id: c.id,
        status: 'pending' as const,
      }));
      const INSERT_CHUNK = 200;
      const recipientIds: { id: string; contact: Contact }[] = [];
      for (let i = 0; i < recipientRows.length; i += INSERT_CHUNK) {
        const { data: inserted, error: recErr } = await supabase
          .from('sms_broadcast_recipients')
          .insert(recipientRows.slice(i, i + INSERT_CHUNK))
          .select('id, contact_id');
        if (recErr || !inserted) {
          await supabase
            .from('sms_broadcasts')
            .update({ status: 'failed', failed_count: contacts.length })
            .eq('id', broadcast.id);
          throw new Error(`Failed to create SMS recipients: ${recErr?.message ?? 'unknown error'}`);
        }
        for (const row of inserted) {
          const contact = contacts.find((c) => c.id === row.contact_id);
          if (contact) recipientIds.push({ id: row.id, contact });
        }
      }

      const { sentCount, failedCount } = await runSmsSendLoop(
        supabase,
        recipientIds,
        params.body,
        (pct) => setProgress(25 + Math.round(pct * 0.7)),
      );

      setProgress(98);
      await supabase
        .from('sms_broadcasts')
        .update({
          status: sentCount > 0 ? 'sent' : 'failed',
          sent_count: sentCount,
          failed_count: failedCount,
        })
        .eq('id', broadcast.id);

      setProgress(100);
      return broadcast.id;
    } finally {
      setIsProcessing(false);
    }
  }

  async function retryFailedSmsBroadcast(broadcastId: string): Promise<void> {
    setIsProcessing(true);
    setProgress(0);
    const supabase = createClient();

    try {
      const { data: broadcast, error: broadcastError } = await supabase
        .from('sms_broadcasts')
        .select('id, body_text, sent_count')
        .eq('id', broadcastId)
        .single();
      if (broadcastError || !broadcast) {
        throw new Error(`Failed to load SMS broadcast: ${broadcastError?.message ?? 'unknown error'}`);
      }

      setProgress(10);
      const { data: failedRows, error: failedErr } = await supabase
        .from('sms_broadcast_recipients')
        .select('id, contact:contacts(*)')
        .eq('sms_broadcast_id', broadcastId)
        .eq('status', 'failed');
      if (failedErr) {
        throw new Error(`Failed to load failed recipients: ${failedErr.message}`);
      }

      const retryTargets: SmsSendLoopRecipient[] = (
        (failedRows ?? []) as unknown as { id: string; contact: Contact | null }[]
      )
        .filter((row): row is { id: string; contact: Contact } => Boolean(row.contact))
        .map((row) => ({ id: row.id, contact: row.contact }));

      if (retryTargets.length === 0) {
        throw new Error('No failed recipients to retry.');
      }

      // Reset to 'pending' before resending so a recipient that fails
      // again for the same reason doesn't briefly read as stale 'failed'
      // data from the previous attempt.
      await supabase
        .from('sms_broadcast_recipients')
        .update({ status: 'pending', error_message: null })
        .in('id', retryTargets.map((r) => r.id));

      setProgress(20);
      // Each retried recipient re-enters resolveSmsConversation via
      // /api/sms/broadcast-send. A recipient whose conversation was never
      // created (the old per-user-rate-limit bug) gets a fresh
      // round-robin device pick — automatically landing on a different
      // SIM if the original is now full. A recipient with an
      // already-pinned conversation normally retries on that same
      // device (see lib/sms/conversation.ts) — but isRetry=true here
      // additionally lets sendSmsToConversation re-pin to a different
      // device if the pinned one is still at its cap, since a retry
      // target never actually received a message from it.
      const { sentCount, failedCount } = await runSmsSendLoop(
        supabase,
        retryTargets,
        broadcast.body_text,
        (pct) => setProgress(20 + Math.round(pct * 0.75)),
        true,
      );

      setProgress(98);
      const newSentCount = (broadcast.sent_count ?? 0) + sentCount;
      await supabase
        .from('sms_broadcasts')
        .update({
          status: newSentCount > 0 ? 'sent' : 'failed',
          sent_count: newSentCount,
          failed_count: failedCount,
        })
        .eq('id', broadcastId);

      setProgress(100);
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendSmsBroadcast, retryFailedSmsBroadcast, isProcessing, progress };
}
