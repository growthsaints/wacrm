import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/contacts/resolve-import-tags', () => ({
  resolveImportTagIds: vi.fn(),
  assignImportedContactTags: vi.fn(),
}));

import { findColdContactIds, tagColdContacts } from './cold-contacts';
import { resolveImportTagIds, assignImportedContactTags } from '@/lib/contacts/resolve-import-tags';

function makeDb(opts: {
  conversations: Array<{ id: string; contact_id: string }>;
  customerMessages: Array<{ conversation_id: string }>;
}) {
  const from = vi.fn((table: string) => {
    if (table === 'conversations') {
      return {
        select: () => ({
          in: async () => ({ data: opts.conversations, error: null }),
        }),
      };
    }
    if (table === 'messages') {
      return {
        select: () => ({
          eq: () => ({
            in: async () => ({ data: opts.customerMessages, error: null }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });
  return { from } as unknown as SupabaseClient;
}

describe('findColdContactIds', () => {
  it('returns an empty set for an empty input list', async () => {
    const db = makeDb({ conversations: [], customerMessages: [] });
    const result = await findColdContactIds(db, []);
    expect(result.size).toBe(0);
  });

  it('treats a contact with no conversation at all as cold', async () => {
    const db = makeDb({ conversations: [], customerMessages: [] });
    const result = await findColdContactIds(db, ['c-1']);
    expect(result).toEqual(new Set(['c-1']));
  });

  it('treats a contact whose conversation has only outbound messages as cold', async () => {
    const db = makeDb({
      conversations: [{ id: 'conv-1', contact_id: 'c-1' }],
      customerMessages: [], // no inbound (sender_type='customer') messages
    });
    const result = await findColdContactIds(db, ['c-1']);
    expect(result).toEqual(new Set(['c-1']));
  });

  it('excludes a contact that has sent at least one inbound message', async () => {
    const db = makeDb({
      conversations: [
        { id: 'conv-1', contact_id: 'c-1' },
        { id: 'conv-2', contact_id: 'c-2' },
      ],
      customerMessages: [{ conversation_id: 'conv-1' }],
    });
    const result = await findColdContactIds(db, ['c-1', 'c-2']);
    expect(result).toEqual(new Set(['c-2']));
  });
});

describe('tagColdContacts', () => {
  it('resolves/creates the Cold tag and assigns it to every given contact', async () => {
    const db = {} as SupabaseClient;
    vi.mocked(resolveImportTagIds).mockResolvedValue({
      tagIdByKey: new Map([['cold', 'tag-cold-1']]),
      skippedNames: [],
    });
    vi.mocked(assignImportedContactTags).mockResolvedValue(2);

    const result = await tagColdContacts(db, 'acct-1', 'user-1', ['c-1', 'c-2']);

    expect(resolveImportTagIds).toHaveBeenCalledWith(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      tagNames: ['Cold'],
      canCreateTags: true,
      defaultColor: '#94a3b8',
    });
    expect(assignImportedContactTags).toHaveBeenCalledWith(
      db,
      [
        { contactId: 'c-1', tagNames: ['Cold'] },
        { contactId: 'c-2', tagNames: ['Cold'] },
      ],
      new Map([['cold', 'tag-cold-1']])
    );
    expect(result).toEqual({ tagId: 'tag-cold-1', tagged: 2 });
  });

  it('throws if the Cold tag could not be resolved or created', async () => {
    const db = {} as SupabaseClient;
    vi.mocked(resolveImportTagIds).mockResolvedValue({
      tagIdByKey: new Map(),
      skippedNames: ['Cold'],
    });

    await expect(tagColdContacts(db, 'acct-1', 'user-1', ['c-1'])).rejects.toThrow();
  });
});
