'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { BroadcastRecipient, Contact, MessageTemplate } from '@/types';
import { shouldTestBatchFirst, TEST_BATCH_SIZE } from '@/lib/whatsapp/test-batch';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
}

/**
 * Variable mapping — each template placeholder (by key, usually "1",
 * "2", …) is resolved at send time. `field` maps to a built-in contact
 * field (name/phone/email/company); `custom_field` maps to a
 * contact_custom_values.value row keyed by the custom_fields.id stored
 * in `value`. `fallback` (field/custom_field only) is substituted when
 * that contact's own value is empty, rather than shipping a blank —
 * e.g. "Hi ," for a contact with no name on file.
 */
export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string; fallback?: string }
  | { type: 'custom_field'; value: string; fallback?: string };

interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  /**
   * Media URL for an IMAGE/VIDEO/DOCUMENT header. Required at send
   * time for media-header templates — Meta rejects the send without
   * it. Passed through as `messageParams.headerMediaUrl`; the builder
   * falls back to the template's stored URL only when this is empty.
   */
  headerMediaUrl?: string;
  /**
   * Per-card variable mappings and media URLs for a Carousel template,
   * parallel to `template.cards`. Every recipient gets the same media
   * (it's a broadcast, not per-contact media) but each card's {{N}}
   * placeholders still resolve per-contact via the same field/custom-
   * field mapping as the main body.
   */
  cardVariables?: Record<string, VariableMapping>[];
  cardHeaderMediaUrls?: string[];
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  resumeBroadcast: (broadcastId: string) => Promise<void>;
  isProcessing: boolean;
  progress: number;
}

/**
 * Meta rate-limit buffer. 10 per batch + 1 s pause matches the spec
 * and keeps us comfortably under Meta's per-phone-number messaging
 * rate so a large broadcast never trips the upstream limiter.
 */
const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;

/** `broadcast_recipients` inserts are independent of the send rate. */
const INSERT_BATCH_SIZE = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch `contacts` rows by id, batched. A single `.in('id', ids)` call
 * with a large list (e.g. every contact carrying a common tag) builds a
 * request whose query string can exceed the server's URL-length limit,
 * which comes back as a bare "Bad Request" with no useful detail —
 * exactly what large-audience tag/custom-field broadcasts were hitting.
 * Same chunk size as the CSV import's insert batches (import-modal.tsx).
 */
async function fetchContactsByIds(
  supabase: ReturnType<typeof createClient>,
  ids: string[],
): Promise<Contact[]> {
  const CHUNK_SIZE = 200;
  const contacts: Contact[] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .in('id', chunk);
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    contacts.push(...((data ?? []) as Contact[]));
  }
  return contacts;
}

interface BroadcastApiResult {
  phone: string;
  status: 'sent' | 'failed';
  whatsapp_message_id?: string;
  error?: string;
}

/** contactId → (customFieldId → value). */
type CustomValueIndex = Map<string, Map<string, string>>;

/**
 * Per-contact resolution of custom-field placeholders. Static and
 * built-in-field mappings resolve synchronously; custom fields read
 * from a pre-built index to avoid N+1 queries during the send loop.
 */
export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>,
): string[] {
  // Keys are typically "1","2",... — numeric-aware sort keeps
  // {{1}} before {{10}}.
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const v = variables[key];
    if (v.type === 'static') return v.value;

    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[v.value]?.trim() || v.fallback || '';
    }

    // custom_field
    return customValues?.get(v.value)?.trim() || v.fallback || '';
  });
}

/**
 * Bulk-fetch contact_custom_values for a set of contacts. Returns an
 * index keyed by contact_id → field_id → value.
 */
async function fetchCustomValueIndex(
  supabase: ReturnType<typeof createClient>,
  contactIds: string[],
): Promise<CustomValueIndex> {
  const index: CustomValueIndex = new Map();
  if (contactIds.length === 0) return index;

  // Supabase PostgREST caps the .in(...) IN-clause roughly at 1000
  // values. Page through to stay safe.
  const PAGE = 500;
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const slice = contactIds.slice(i, i + PAGE);
    const { data } = await supabase
      .from('contact_custom_values')
      .select('contact_id, custom_field_id, value')
      .in('contact_id', slice);

    for (const row of data ?? []) {
      const bucket = index.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(row.custom_field_id, row.value ?? '');
      index.set(row.contact_id, bucket);
    }
  }
  return index;
}

interface RunSendLoopParams {
  supabase: ReturnType<typeof createClient>;
  /** Rows to send to — either freshly inserted, or a broadcast's still-pending set on resume. */
  recipients: (BroadcastRecipient & { contact?: Contact | null })[];
  templateName: string;
  templateLanguage: string;
  variables: Record<string, VariableMapping>;
  customValueIndex: CustomValueIndex;
  headerType?: MessageTemplate['header_type'];
  headerMediaUrl?: string;
  cards?: MessageTemplate['cards'];
  cardVariablesList?: Record<string, VariableMapping>[];
  cardHeaderMediaUrls?: string[];
  /** 0–100, relative to this call's own recipient list. */
  onProgress?: (pct: number) => void;
}

/**
 * The actual per-recipient Meta send loop — batches of SEND_BATCH_SIZE,
 * paced by SEND_BATCH_DELAY_MS. Shared by the initial send
 * (createAndSendBroadcast) and resuming a broadcast whose recipients
 * are still stuck at 'pending' (resumeBroadcast) — see the note on
 * resumeBroadcast for why "stuck pending" happens at all.
 */
async function runSendLoop(params: RunSendLoopParams): Promise<{ failedCount: number }> {
  const {
    supabase,
    recipients,
    templateName,
    templateLanguage,
    variables,
    customValueIndex,
    headerType,
    headerMediaUrl,
    cards = [],
    cardVariablesList = [],
    cardHeaderMediaUrls = [],
    onProgress,
  } = params;

  const isMediaHeader =
    headerType === 'image' || headerType === 'video' || headerType === 'document';
  const trimmedHeaderMediaUrl = headerMediaUrl?.trim();
  const totalRecipients = recipients.length;
  let failedCount = 0;

  function buildCardParams(contact: Contact, customValues?: Map<string, string>) {
    if (cards.length === 0) return undefined;
    return cards.map((_, ci) => ({
      body: resolveVariables(cardVariablesList[ci] ?? {}, contact, customValues),
      headerMediaUrl: cardHeaderMediaUrls[ci]?.trim() || undefined,
    }));
  }

  for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
    const batch = recipients.slice(i, i + SEND_BATCH_SIZE);

    const apiRecipients = batch
      .filter((r) => r.contact?.phone)
      .map((r) => {
        const customValues = r.contact ? customValueIndex.get(r.contact.id) : undefined;
        const cardParams = r.contact ? buildCardParams(r.contact, customValues) : undefined;
        const messageParams =
          (isMediaHeader && trimmedHeaderMediaUrl) || cardParams
            ? {
                ...(isMediaHeader && trimmedHeaderMediaUrl ? { headerMediaUrl: trimmedHeaderMediaUrl } : {}),
                ...(cardParams ? { cards: cardParams } : {}),
              }
            : undefined;
        return {
          phone: r.contact!.phone as string,
          contactId: r.contact!.id,
          params: r.contact ? resolveVariables(variables, r.contact, customValues) : [],
          ...(messageParams ? { messageParams } : {}),
        };
      });

    if (apiRecipients.length === 0) continue;

    try {
      const res = await fetch('/api/whatsapp/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: apiRecipients,
          template_name: templateName,
          template_language: templateLanguage,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Broadcast API request failed');
      }

      const resultsByPhone = new Map<string, BroadcastApiResult>();
      for (const r of (data.results ?? []) as BroadcastApiResult[]) {
        resultsByPhone.set(r.phone, r);
      }

      for (const recipient of batch) {
        const phone = recipient.contact?.phone;
        const result = phone ? resultsByPhone.get(phone) : undefined;

        if (!result) {
          failedCount++;
          await supabase
            .from('broadcast_recipients')
            .update({
              status: 'failed',
              error_message: 'No phone number on contact',
            })
            .eq('id', recipient.id);
          continue;
        }

        if (result.status === 'sent') {
          await supabase
            .from('broadcast_recipients')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              whatsapp_message_id: result.whatsapp_message_id ?? null,
              error_message: null,
            })
            .eq('id', recipient.id);
        } else {
          failedCount++;
          await supabase
            .from('broadcast_recipients')
            .update({
              status: 'failed',
              error_message: result.error ?? 'Unknown error',
            })
            .eq('id', recipient.id);
        }
      }
    } catch (err) {
      for (const recipient of batch) {
        failedCount++;
        await supabase
          .from('broadcast_recipients')
          .update({
            status: 'failed',
            error_message: err instanceof Error ? err.message : 'Unknown error',
          })
          .eq('id', recipient.id);
      }
    }

    const localPct = Math.round(((i + batch.length) / totalRecipients) * 100);
    onProgress?.(localPct);

    if (i + SEND_BATCH_SIZE < recipients.length) {
      await sleep(SEND_BATCH_DELAY_MS);
    }
  }

  return { failedCount };
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const { accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function resolveAudience(audience: AudienceConfig): Promise<Contact[]> {
    const supabase = createClient();

    let contacts: Contact[] = [];

    if (audience.type === 'all') {
      const { data, error } = await supabase.from('contacts').select('*');
      if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
      contacts = data ?? [];
    } else if (
      audience.type === 'tags' &&
      audience.tagIds &&
      audience.tagIds.length > 0
    ) {
      const { data: contactTags, error: tagError } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', audience.tagIds);

      if (tagError)
        throw new Error(`Failed to fetch contact tags: ${tagError.message}`);

      if (contactTags && contactTags.length > 0) {
        const uniqueContactIds = [
          ...new Set(contactTags.map((ct) => ct.contact_id)),
        ];
        contacts = await fetchContactsByIds(supabase, uniqueContactIds);
      }
    } else if (audience.type === 'custom_field' && audience.customField) {
      contacts = await resolveCustomFieldAudience(supabase, audience.customField);
    } else if (audience.type === 'csv' && audience.csvContacts) {
      contacts = await upsertCsvContacts(supabase, audience.csvContacts);
    }

    // Apply exclude tags (works across all contact-derived audience
    // types). CSV contacts are synthetic so exclusion doesn't apply.
    if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
      const { data: excludeRows } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', audience.excludeTagIds);
      const excludedIds = new Set((excludeRows ?? []).map((r) => r.contact_id));
      contacts = contacts.filter((c) => !excludedIds.has(c.id));
    }

    // Never send marketing broadcasts to a contact who's opted out —
    // applies regardless of how the audience was built (all/tags/
    // custom field/CSV), since it's a property of the contact row
    // itself, not something a specific audience type can bypass.
    contacts = contacts.filter((c) => !c.marketing_opt_out);

    return contacts;
  }

  /**
   * CSV uploads arrive as raw phone/name pairs, not DB rows. Before we
   * can insert broadcast_recipients (whose contact_id FKs contacts.id),
   * we need real contacts.id UUIDs. So: look up each CSV phone in the
   * caller's contacts table; insert any that don't exist; return the
   * resolved set.
   *
   * Pre-existing implementation synthesized `csv-N` strings as
   * contact_id, which failed the UUID cast on insert — every CSV
   * broadcast silently created zero recipients.
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
    if (!user) {
      throw new Error('You are not signed in.');
    }
    if (!accountId) {
      throw new Error('Your profile is not linked to an account.');
    }

    // De-duplicate by phone within the CSV (users can paste duplicates).
    const uniqueByPhone = new Map<string, { phone: string; name?: string }>();
    for (const row of csvRows) {
      if (row.phone) uniqueByPhone.set(row.phone, row);
    }
    const phones = [...uniqueByPhone.keys()];

    // Lookup existing contacts by phone, batched — a single .in() call
    // with a large CSV's worth of phones can build a request whose URL
    // exceeds the server's length limit (same failure mode fixed in
    // fetchContactsByIds for tag/custom-field audiences).
    const LOOKUP_CHUNK = 200;
    const byPhone = new Map<string, Contact>();
    for (let i = 0; i < phones.length; i += LOOKUP_CHUNK) {
      const chunk = phones.slice(i, i + LOOKUP_CHUNK);
      const { data: existing, error: lookupErr } = await supabase
        .from('contacts')
        .select('*')
        .eq('user_id', user.id)
        .in('phone', chunk);
      if (lookupErr) {
        throw new Error(`Failed to look up CSV contacts: ${lookupErr.message}`);
      }
      for (const c of (existing ?? []) as Contact[]) {
        if (c.phone) byPhone.set(c.phone, c);
      }
    }

    // Insert only missing contacts, in one batch per 200 rows (PostgREST
    // has a default payload cap — 200 keeps individual requests small).
    const missing = phones
      .filter((p) => !byPhone.has(p))
      .map((phone) => ({
        user_id: user.id,
        account_id: accountId,
        phone,
        name: uniqueByPhone.get(phone)?.name ?? null,
      }));

    const INSERT_CHUNK = 200;
    for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
      const chunk = missing.slice(i, i + INSERT_CHUNK);
      const { data: inserted, error: insertErr } = await supabase
        .from('contacts')
        .insert(chunk)
        .select();
      if (insertErr) {
        throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
      }
      for (const c of (inserted ?? []) as Contact[]) {
        if (c.phone) byPhone.set(c.phone, c);
      }
    }

    // Preserve input order so analytics roughly matches the CSV order.
    return phones
      .map((p) => byPhone.get(p))
      .filter((c): c is Contact => Boolean(c));
  }

  async function resolveCustomFieldAudience(
    supabase: ReturnType<typeof createClient>,
    filter: CustomFieldFilter,
  ): Promise<Contact[]> {
    const { fieldId, operator, value } = filter;

    // Build the WHERE clause for the operator. PostgREST supports
    // eq/neq/ilike via the query builder — use ilike with wildcards
    // for "contains" so the match is case-insensitive.
    let query = supabase
      .from('contact_custom_values')
      .select('contact_id')
      .eq('custom_field_id', fieldId);

    if (operator === 'is') query = query.eq('value', value);
    else if (operator === 'is_not') query = query.neq('value', value);
    else if (operator === 'contains') query = query.ilike('value', `%${value}%`);

    const { data: matches, error: matchErr } = await query;
    if (matchErr)
      throw new Error(`Custom-field filter failed: ${matchErr.message}`);

    const contactIds = [...new Set((matches ?? []).map((m) => m.contact_id))];
    if (contactIds.length === 0) return [];

    return fetchContactsByIds(supabase, contactIds);
  }

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);

    const supabase = createClient();

    try {
      // ── Step 0: Resolve current user ──────────────────────────────
      // broadcasts.user_id is NOT NULL + guarded by RLS
      // (auth.uid() = user_id). Without this, the INSERT below was
      // silently failing with 23502 / 42501 — the wizard would
      // no-op with no feedback.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        throw new Error('You are not signed in.');
      }
      if (!accountId) {
        throw new Error('Your profile is not linked to an account.');
      }

      // ── Step 1: Resolve audience contacts ─────────────────────────
      setProgress(5);
      const contacts = await resolveAudience(payload.audience);

      if (contacts.length === 0) {
        throw new Error('No contacts found for this audience.');
      }

      // ── Step 2: Create broadcast row ──────────────────────────────
      setProgress(10);
      const { data: broadcast, error: broadcastError } = await supabase
        .from('broadcasts')
        .insert({
          user_id: user.id,
          account_id: accountId,
          name: payload.name,
          template_name: payload.template.name,
          template_language: payload.template.language ?? 'en_US',
          template_variables: payload.variables,
          audience_filter: {
            type: payload.audience.type,
            tagIds: payload.audience.tagIds,
            customField: payload.audience.customField,
            excludeTagIds: payload.audience.excludeTagIds,
          },
          status: 'sending',
          total_recipients: contacts.length,
          sent_count: 0,
          delivered_count: 0,
          read_count: 0,
          replied_count: 0,
          failed_count: 0,
        })
        .select()
        .single();

      if (broadcastError || !broadcast) {
        throw new Error(
          `Failed to create broadcast: ${broadcastError?.message ?? 'unknown error'}`,
        );
      }

      // ── Step 3: Insert recipient rows ─────────────────────────────
      setProgress(20);
      const recipientRows = contacts.map((contact) => ({
        broadcast_id: broadcast.id,
        contact_id: contact.id,
        status: 'pending' as const,
      }));

      for (let i = 0; i < recipientRows.length; i += INSERT_BATCH_SIZE) {
        const batch = recipientRows.slice(i, i + INSERT_BATCH_SIZE);
        const { error: recipientError } = await supabase
          .from('broadcast_recipients')
          .insert(batch);
        if (recipientError) {
          // Previous impl logged and marched on — the broadcast then ran
          // with an incomplete recipient set, so webhook status updates
          // couldn't find some rows and the aggregate counts drifted.
          // Flip the broadcast to failed so the user sees the problem
          // immediately, then throw to abort the send loop.
          await supabase
            .from('broadcasts')
            .update({
              status: 'failed',
              failed_count: contacts.length,
            })
            .eq('id', broadcast.id);
          throw new Error(
            `Failed to insert recipient batch ${i / INSERT_BATCH_SIZE + 1}: ${recipientError.message}`,
          );
        }
      }

      // ── Step 4: Fetch recipients (joined contact) + preload custom values
      setProgress(30);
      const { data: recipients, error: recipientsFetchError } = await supabase
        .from('broadcast_recipients')
        .select('*, contact:contacts(*)')
        .eq('broadcast_id', broadcast.id);

      if (recipientsFetchError || !recipients) {
        throw new Error('Failed to fetch broadcast recipients');
      }

      // One bulk fetch of custom values for every contact in this
      // broadcast, avoiding N+1 during the send loop.
      const contactIds = recipients
        .map((r) => r.contact?.id)
        .filter((id): id is string => Boolean(id));
      const customValueIndex = await fetchCustomValueIndex(
        supabase,
        contactIds,
      );

      const totalRecipients = recipients.length;

      // Large audiences send a small test batch first and then stop —
      // a bad template or a bad audience should be caught while only a
      // handful of contacts have been messaged, not after hundreds have
      // (exactly the pattern that trips Meta's quality-rating
      // enforcement). The rest stay `pending`; the broadcast detail
      // page's existing "Resend to Pending" action — already wired to
      // resumeBroadcast() below — doubles as the human confirmation
      // step to send the remainder.
      const isLargeBroadcast = shouldTestBatchFirst(totalRecipients);
      const recipientsToSend = isLargeBroadcast
        ? recipients.slice(0, TEST_BATCH_SIZE)
        : recipients;

      // Media-header templates (image/video/document) require a media
      // URL on every send. Collected in the personalize step and applied
      // to all recipients; falls back to the template's stored URL on the
      // server when omitted.
      const { failedCount } = await runSendLoop({
        supabase,
        recipients: recipientsToSend,
        templateName: payload.template.name,
        templateLanguage: payload.template.language ?? 'en_US',
        variables: payload.variables,
        customValueIndex,
        headerType: payload.template.header_type,
        headerMediaUrl: payload.headerMediaUrl,
        cards: payload.template.cards ?? [],
        cardVariablesList: payload.cardVariables ?? [],
        cardHeaderMediaUrls: payload.cardHeaderMediaUrls ?? [],
        onProgress: (localPct) => setProgress(30 + Math.round(localPct * 0.6)),
      });

      // ── Step 5: Finalize status ───────────────────────────────────
      // Aggregate counts are maintained by the DB trigger (migration
      // 003); we only flip the final status here.
      setProgress(95);
      const allSentFailed = failedCount === recipientsToSend.length;
      const finalStatus = allSentFailed
        ? 'failed'
        : isLargeBroadcast
          ? 'awaiting_confirmation'
          : 'sent';
      await supabase
        .from('broadcasts')
        .update({ status: finalStatus })
        .eq('id', broadcast.id);

      setProgress(100);
      return broadcast.id;
    } finally {
      setIsProcessing(false);
    }
  }

  /**
   * Sending runs as a client-side loop in the browser tab that launched
   * it (batches of SEND_BATCH_SIZE, paced by SEND_BATCH_DELAY_MS) — there
   * is no server-side queue behind it. If that tab is closed, refreshed,
   * or navigated away from mid-send, the loop simply stops: whatever
   * batch was in flight gets marked 'failed' (or partially 'sent'), and
   * every recipient after it stays 'pending' forever with nothing to
   * resume it automatically.
   *
   * This re-derives everything the original send needed — the template
   * row (for header/cards) and the broadcast's own stored
   * `template_variables` mapping — and re-runs the same send loop
   * against only the recipients still stuck at 'pending'. Per-recipient
   * media header/card overrides from the original wizard aren't
   * persisted anywhere, so a resumed send falls back to the template's
   * own stored header media (same fallback the original send already
   * uses server-side).
   */
  async function resumeBroadcast(broadcastId: string): Promise<void> {
    setIsProcessing(true);
    setProgress(0);
    const supabase = createClient();

    try {
      const { data: broadcast, error: bErr } = await supabase
        .from('broadcasts')
        .select('*')
        .eq('id', broadcastId)
        .single();
      if (bErr || !broadcast) {
        throw new Error('Broadcast not found.');
      }

      setProgress(10);
      const { data: templateRow } = await supabase
        .from('message_templates')
        .select('*')
        .eq('name', broadcast.template_name)
        .eq('language', broadcast.template_language)
        .maybeSingle();

      const { data: pending, error: recErr } = await supabase
        .from('broadcast_recipients')
        .select('*, contact:contacts(*)')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'pending');
      if (recErr) {
        throw new Error(`Failed to fetch pending recipients: ${recErr.message}`);
      }
      if (!pending || pending.length === 0) {
        throw new Error('No pending recipients left to resend.');
      }

      setProgress(20);
      const contactIds = pending
        .map((r) => r.contact?.id)
        .filter((id): id is string => Boolean(id));
      const customValueIndex = await fetchCustomValueIndex(supabase, contactIds);

      const variables = (broadcast.template_variables ?? {}) as Record<
        string,
        VariableMapping
      >;

      await runSendLoop({
        supabase,
        recipients: pending,
        templateName: broadcast.template_name,
        templateLanguage: broadcast.template_language,
        variables,
        customValueIndex,
        headerType: templateRow?.header_type,
        cards: templateRow?.cards ?? [],
        onProgress: (localPct) => setProgress(20 + Math.round(localPct * 0.75)),
      });

      setProgress(95);
      const { data: freshCounts } = await supabase
        .from('broadcasts')
        .select('total_recipients, failed_count')
        .eq('id', broadcastId)
        .single();
      const finalStatus =
        (freshCounts?.failed_count ?? 0) >= (freshCounts?.total_recipients ?? pending.length)
          ? 'failed'
          : 'sent';
      await supabase
        .from('broadcasts')
        .update({ status: finalStatus })
        .eq('id', broadcastId);

      setProgress(100);
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, resumeBroadcast, isProcessing, progress };
}
