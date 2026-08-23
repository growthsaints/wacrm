import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveImportTagIds, assignImportedContactTags } from '@/lib/contacts/resolve-import-tags';

const CHUNK_SIZE = 200;
const COLD_TAG_NAME = 'Cold';

/**
 * A contact is "cold" if they have never sent an inbound WhatsApp
 * message — no two-way engagement, ever, regardless of how many times
 * the business has messaged them. Broadcasting to an audience with a
 * large cold share is exactly the pattern Meta's quality-rating
 * enforcement penalizes: blocks and spam reports come disproportionately
 * from people who never actually opted into a conversation. Surfaced as
 * a warning in the broadcast wizard's audience step (see
 * step2-select-audience.tsx) rather than silently allowed through.
 *
 * Computed as a set difference across two chunked lookups — contacts
 * with a conversation carrying at least one customer-authored message
 * are "warm"; everyone else in the input list (no conversation at all,
 * or a conversation where the business always spoke first) is "cold" —
 * mirroring the fetchContactsByIds/fetchCustomValueIndex chunking
 * pattern in use-broadcast-sending.ts so a large audience doesn't build
 * a request whose URL exceeds PostgREST's length limit.
 */
export async function findColdContactIds(
  supabase: SupabaseClient,
  contactIds: string[]
): Promise<Set<string>> {
  if (contactIds.length === 0) return new Set();

  const contactIdByConversation = new Map<string, string>();
  for (let i = 0; i < contactIds.length; i += CHUNK_SIZE) {
    const chunk = contactIds.slice(i, i + CHUNK_SIZE);
    const { data, error } = await supabase
      .from('conversations')
      .select('id, contact_id')
      .in('contact_id', chunk);
    if (error) {
      throw new Error(`Failed to load conversations for cold-contact check: ${error.message}`);
    }
    for (const row of data ?? []) {
      if (row.contact_id) contactIdByConversation.set(row.id, row.contact_id);
    }
  }

  const conversationIds = [...contactIdByConversation.keys()];
  const warmContactIds = new Set<string>();
  for (let i = 0; i < conversationIds.length; i += CHUNK_SIZE) {
    const chunk = conversationIds.slice(i, i + CHUNK_SIZE);
    const { data, error } = await supabase
      .from('messages')
      .select('conversation_id')
      .eq('sender_type', 'customer')
      .in('conversation_id', chunk);
    if (error) {
      throw new Error(`Failed to load messages for cold-contact check: ${error.message}`);
    }
    for (const row of data ?? []) {
      const contactId = contactIdByConversation.get(row.conversation_id);
      if (contactId) warmContactIds.add(contactId);
    }
  }

  return new Set(contactIds.filter((id) => !warmContactIds.has(id)));
}

/**
 * Applies a "Cold" tag (found or created — reuses the same find-or-
 * create helper the CSV importer uses) to a set of contacts flagged by
 * {@link findColdContactIds}. Persisting this as a real tag, rather
 * than just a one-off warning, lets it be plugged straight into the
 * broadcast wizard's existing "Exclude Tags" filter (step2) for future
 * sends — closing the loop from "warn about it" to "actually stop
 * messaging them" without needing new audience-filtering machinery.
 */
export async function tagColdContacts(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  contactIds: string[]
): Promise<{ tagId: string; tagged: number }> {
  const { tagIdByKey } = await resolveImportTagIds(supabase, {
    accountId,
    userId,
    tagNames: [COLD_TAG_NAME],
    canCreateTags: true,
    defaultColor: '#94a3b8',
  });
  const tagId = tagIdByKey.get(COLD_TAG_NAME.toLowerCase());
  if (!tagId) {
    throw new Error(`Failed to find or create the "${COLD_TAG_NAME}" tag`);
  }

  const tagged = await assignImportedContactTags(
    supabase,
    contactIds.map((contactId) => ({ contactId, tagNames: [COLD_TAG_NAME] })),
    tagIdByKey
  );

  return { tagId, tagged };
}
