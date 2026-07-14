import type { Conversation, Contact, Tag } from "@/types";

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 *
 * `conversation_favorites(id)` embeds the CALLER's own favorite row for
 * this conversation, if any — the table's RLS (migration 039) already
 * restricts every row to `user_id = auth.uid()`, so any row that comes
 * back here is guaranteed to be the current agent's, not a teammate's.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*))), conversation_favorites(id)";

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };
type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
  conversation_favorites?: { id: string }[] | null;
};

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`,
 * and `conversation_favorites(id)` into a boolean `is_favorite`. Safe to
 * call on rows fetched with {@link CONVERSATION_SELECT}; a row with no
 * contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const { conversation_favorites, contact: rawContact, ...rest } = raw;
  const is_favorite = (conversation_favorites ?? []).length > 0;

  if (!rawContact) {
    return { ...rest, contact: rawContact, is_favorite } as Conversation;
  }

  const { contact_tags, ...contact } = rawContact;
  return {
    ...rest,
    is_favorite,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}
