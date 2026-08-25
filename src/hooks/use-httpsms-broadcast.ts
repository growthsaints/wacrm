'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { Contact } from '@/types';

export type HttpSmsCustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface HttpSmsCustomFieldFilter {
  fieldId: string;
  operator: HttpSmsCustomFieldOperator;
  value: string;
}

export interface HttpSmsAudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  customField?: HttpSmsCustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
}

interface CreateHttpSmsBroadcastParams {
  name: string;
  body: string;
  audience: HttpSmsAudienceConfig;
  // Send every NEW conversation this campaign opens through this one
  // number instead of round-robin. A contact who already has an
  // httpSMS conversation keeps using whichever number it was
  // originally pinned to — this only steers brand-new conversations.
  // Omit for the default auto-distribute behavior.
  preferredConfigId?: string;
}

interface UseHttpSmsBroadcastReturn {
  createAndSendHttpSmsBroadcast: (params: CreateHttpSmsBroadcastParams) => Promise<string>;
  retryFailedHttpSmsBroadcast: (broadcastId: string) => Promise<void>;
  isProcessing: boolean;
  progress: number;
}

/**
 * Same pacing as the SMS/WhatsApp broadcast hooks — 10 per batch + 1s
 * pause. httpSMS paces the actual send per-phone on its own side
 * (Settings → Control SMS Send Rate on httpsms.com, default 10/min,
 * up to 29/min), but batching our own dispatch keeps a big campaign
 * from firing hundreds of requests at our own API in one burst.
 */
const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;
const CHUNK_SIZE = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Positional {{name}} substitution only — httpSMS broadcasts are plain text, no template variable system. */
function personalize(body: string, contact: Contact): string {
  return body.replaceAll('{{name}}', contact.name || contact.phone);
}

interface HttpSmsSendLoopRecipient {
  id: string;
  contact: Contact;
}

/**
 * The actual per-recipient send loop — batches of SEND_BATCH_SIZE,
 * paced by SEND_BATCH_DELAY_MS. Shared by the initial send
 * (createAndSendHttpSmsBroadcast) and retrying failed recipients
 * (retryFailedHttpSmsBroadcast). Unlike the SMS Gateway integration,
 * there's no per-device daily cap to reassign around on retry — a
 * retry is just a plain resend through the same
 * resolveHttpSmsConversation path, which round-robins fresh for any
 * recipient whose conversation was never created.
 */
async function runHttpSmsSendLoop(
  supabase: ReturnType<typeof createClient>,
  recipients: HttpSmsSendLoopRecipient[],
  bodyText: string,
  onProgress: (pct: number) => void,
  preferredConfigId?: string,
): Promise<{ sentCount: number; failedCount: number }> {
  let sentCount = 0;
  let failedCount = 0;
  const total = recipients.length || 1;

  for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
    const batch = recipients.slice(i, i + SEND_BATCH_SIZE);

    await Promise.all(
      batch.map(async ({ id, contact }) => {
        try {
          const res = await fetch('/api/httpsms/broadcast-send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contact_id: contact.id,
              content_text: personalize(bodyText, contact),
              preferred_config_id: preferredConfigId,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            failedCount++;
            await supabase
              .from('httpsms_broadcast_recipients')
              .update({ status: 'failed', error_message: data.error || `HTTP ${res.status}` })
              .eq('id', id);
            return;
          }
          sentCount++;
          await supabase
            .from('httpsms_broadcast_recipients')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              error_message: null,
              httpsms_config_id: data.httpsms_config_id ?? null,
            })
            .eq('id', id);
        } catch (err) {
          failedCount++;
          await supabase
            .from('httpsms_broadcast_recipients')
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

export function useHttpSmsBroadcast(): UseHttpSmsBroadcastReturn {
  const { accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function resolveCustomFieldAudience(
    supabase: ReturnType<typeof createClient>,
    filter: HttpSmsCustomFieldFilter,
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
   * Same shape/behavior as use-sms-broadcast.ts's own copy (kept
   * separate rather than shared — that file is SMS-Gateway-specific
   * and out of scope to touch here).
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

  async function resolveAudience(audience: HttpSmsAudienceConfig): Promise<Contact[]> {
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

  async function createAndSendHttpSmsBroadcast(params: CreateHttpSmsBroadcastParams): Promise<string> {
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

      setProgress(15);
      const { data: broadcast, error: broadcastError } = await supabase
        .from('httpsms_broadcasts')
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
        throw new Error(`Failed to create httpSMS broadcast: ${broadcastError?.message ?? 'unknown error'}`);
      }

      setProgress(25);
      const recipientRows = contacts.map((c) => ({
        httpsms_broadcast_id: broadcast.id,
        contact_id: c.id,
        status: 'pending' as const,
      }));
      const INSERT_CHUNK = 200;
      const recipientIds: { id: string; contact: Contact }[] = [];
      for (let i = 0; i < recipientRows.length; i += INSERT_CHUNK) {
        const { data: inserted, error: recErr } = await supabase
          .from('httpsms_broadcast_recipients')
          .insert(recipientRows.slice(i, i + INSERT_CHUNK))
          .select('id, contact_id');
        if (recErr || !inserted) {
          await supabase
            .from('httpsms_broadcasts')
            .update({ status: 'failed', failed_count: contacts.length })
            .eq('id', broadcast.id);
          throw new Error(`Failed to create httpSMS recipients: ${recErr?.message ?? 'unknown error'}`);
        }
        for (const row of inserted) {
          const contact = contacts.find((c) => c.id === row.contact_id);
          if (contact) recipientIds.push({ id: row.id, contact });
        }
      }

      const { sentCount, failedCount } = await runHttpSmsSendLoop(
        supabase,
        recipientIds,
        params.body,
        (pct) => setProgress(25 + Math.round(pct * 0.7)),
        params.preferredConfigId,
      );

      setProgress(98);
      await supabase
        .from('httpsms_broadcasts')
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

  async function retryFailedHttpSmsBroadcast(broadcastId: string): Promise<void> {
    setIsProcessing(true);
    setProgress(0);
    const supabase = createClient();

    try {
      const { data: broadcast, error: broadcastError } = await supabase
        .from('httpsms_broadcasts')
        .select('id, body_text, sent_count')
        .eq('id', broadcastId)
        .single();
      if (broadcastError || !broadcast) {
        throw new Error(`Failed to load httpSMS broadcast: ${broadcastError?.message ?? 'unknown error'}`);
      }

      setProgress(10);
      const { data: failedRows, error: failedErr } = await supabase
        .from('httpsms_broadcast_recipients')
        .select('id, contact:contacts(*)')
        .eq('httpsms_broadcast_id', broadcastId)
        .eq('status', 'failed');
      if (failedErr) {
        throw new Error(`Failed to load failed recipients: ${failedErr.message}`);
      }

      const retryTargets: HttpSmsSendLoopRecipient[] = (
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
        .from('httpsms_broadcast_recipients')
        .update({ status: 'pending', error_message: null })
        .in('id', retryTargets.map((r) => r.id));

      setProgress(20);
      const { sentCount, failedCount } = await runHttpSmsSendLoop(
        supabase,
        retryTargets,
        broadcast.body_text,
        (pct) => setProgress(20 + Math.round(pct * 0.75)),
      );

      setProgress(98);
      const newSentCount = (broadcast.sent_count ?? 0) + sentCount;
      await supabase
        .from('httpsms_broadcasts')
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

  return { createAndSendHttpSmsBroadcast, retryFailedHttpSmsBroadcast, isProcessing, progress };
}
