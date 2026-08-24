'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { Contact } from '@/types';

export interface SmsAudienceConfig {
  type: 'all' | 'tags';
  tagIds?: string[];
}

interface CreateSmsBroadcastParams {
  name: string;
  body: string;
  audience: SmsAudienceConfig;
}

interface UseSmsBroadcastReturn {
  createAndSendSmsBroadcast: (params: CreateSmsBroadcastParams) => Promise<string>;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Positional {{name}} substitution only — SMS broadcasts are plain text, no template variable system. */
function personalize(body: string, contact: Contact): string {
  return body.replaceAll('{{name}}', contact.name || contact.phone);
}

export function useSmsBroadcast(): UseSmsBroadcastReturn {
  const { accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function resolveAudience(audience: SmsAudienceConfig): Promise<Contact[]> {
    const supabase = createClient();

    if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
      const { data: contactTags, error: tagError } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', audience.tagIds);
      if (tagError) throw new Error(`Failed to fetch contact tags: ${tagError.message}`);

      const ids = [...new Set((contactTags ?? []).map((ct) => ct.contact_id))];
      if (ids.length === 0) return [];

      const CHUNK = 200;
      const contacts: Contact[] = [];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data, error } = await supabase
          .from('contacts')
          .select('*')
          .in('id', ids.slice(i, i + CHUNK));
        if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
        contacts.push(...((data ?? []) as Contact[]));
      }
      return contacts.filter((c) => !c.marketing_opt_out);
    }

    const { data, error } = await supabase.from('contacts').select('*');
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    return ((data ?? []) as Contact[]).filter((c) => !c.marketing_opt_out);
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

      setProgress(15);
      const { data: broadcast, error: broadcastError } = await supabase
        .from('sms_broadcasts')
        .insert({
          account_id: accountId,
          user_id: user.id,
          name: params.name,
          body_text: params.body,
          audience_filter: { type: params.audience.type, tagIds: params.audience.tagIds },
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

      let sentCount = 0;
      let failedCount = 0;
      const total = recipientIds.length;

      for (let i = 0; i < recipientIds.length; i += SEND_BATCH_SIZE) {
        const batch = recipientIds.slice(i, i + SEND_BATCH_SIZE);

        await Promise.all(
          batch.map(async ({ id, contact }) => {
            try {
              const res = await fetch('/api/whatsapp/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contact_id: contact.id,
                  channel: 'sms',
                  message_type: 'text',
                  content_text: personalize(params.body, contact),
                }),
              });
              if (!res.ok) {
                const data = await res.json().catch(() => ({}));
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
                .update({ status: 'sent', sent_at: new Date().toISOString() })
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

        setProgress(25 + Math.round(((i + batch.length) / total) * 70));
        if (i + SEND_BATCH_SIZE < recipientIds.length) {
          await sleep(SEND_BATCH_DELAY_MS);
        }
      }

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

  return { createAndSendSmsBroadcast, isProcessing, progress };
}
