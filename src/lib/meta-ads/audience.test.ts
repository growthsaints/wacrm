import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveAudienceContacts } from './audience'

const ACCOUNT_ID = 'acct-1'

/** Mimics Supabase/PostgREST's real default row cap — a .range() request
 *  only ever gets back at most 1000 rows per page, regardless of how
 *  many rows actually match, so a caller MUST page through with
 *  .range() to see everything. This is the exact behavior that
 *  silently truncated a 5,500-contact "all contacts" audience down to
 *  1,000 before resolveAudienceContacts paginated. */
function makePaginatedRange<T>(total: number, rowAt: (i: number) => T) {
  return vi.fn((start: number, end: number) => {
    const cappedEnd = Math.min(end, start + 999)
    const rows: T[] = []
    for (let i = start; i <= cappedEnd && i < total; i++) rows.push(rowAt(i))
    return Promise.resolve({ data: rows, error: null })
  })
}

/** Every contact in `contactsRows` is treated as opted_in unless
 *  `optedInIds` is passed explicitly — most tests here are about the
 *  marketing_opt_out/phone/pagination logic, not consent, so this
 *  keeps them from having to separately declare consent for every
 *  fixture contact. */
function makeClient(args: {
  contactsRows: Array<{ id: string; phone: string | null; marketing_opt_out?: boolean }>
  optedInIds?: string[]
  tagMatches?: Array<{ contact_id: string }>
}): SupabaseClient {
  const optedInIds = args.optedInIds ?? args.contactsRows.map((r) => r.id)
  const from = vi.fn((table: string) => {
    if (table === 'contacts') {
      return {
        select: () => ({
          range: vi.fn(() => Promise.resolve({ data: args.contactsRows, error: null })),
          in: vi.fn((_col: string, ids: string[]) =>
            Promise.resolve({ data: args.contactsRows.filter((r) => ids.includes(r.id)), error: null }),
          ),
        }),
      }
    }
    if (table === 'contact_consent') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              range: vi.fn(() =>
                Promise.resolve({ data: optedInIds.map((id) => ({ contact_id: id })), error: null }),
              ),
            }),
          }),
        }),
      }
    }
    if (table === 'contact_tags') {
      return {
        select: () => ({
          in: () => ({
            range: vi.fn(() => Promise.resolve({ data: args.tagMatches ?? [], error: null })),
          }),
        }),
      }
    }
    throw new Error(`unexpected table: ${table}`)
  })
  return { from } as unknown as SupabaseClient
}

function makePaginatedClient(total: number): SupabaseClient {
  const contactsRange = makePaginatedRange(total, (i) => ({
    id: `id-${i}`,
    phone: `+9190000${String(i).padStart(4, '0')}`,
    marketing_opt_out: false,
  }))
  const consentRange = makePaginatedRange(total, (i) => ({ contact_id: `id-${i}` }))
  const from = vi.fn((table: string) => {
    if (table === 'contacts') return { select: () => ({ range: contactsRange }) }
    if (table === 'contact_consent') return { select: () => ({ eq: () => ({ eq: () => ({ range: consentRange }) }) }) }
    throw new Error(`unexpected table: ${table}`)
  })
  return { from } as unknown as SupabaseClient
}

describe('resolveAudienceContacts', () => {
  it('paginates past the default 1,000-row cap for a large CRM', async () => {
    const client = makePaginatedClient(5500)
    const result = await resolveAudienceContacts(client, { type: 'all' }, ACCOUNT_ID)
    expect(result).toHaveLength(5500)
    expect(result[0]).toEqual({ id: 'id-0', phone: '+91900000000' })
    expect(result[5499]).toEqual({ id: 'id-5499', phone: '+91900005499' })
  })

  it('returns everything for a count that fits in one page', async () => {
    const client = makePaginatedClient(250)
    const result = await resolveAudienceContacts(client, { type: 'all' }, ACCOUNT_ID)
    expect(result).toHaveLength(250)
  })

  it('drops contacts with no phone number', async () => {
    const client = makeClient({
      contactsRows: [
        { id: '1', phone: '+911234567890' },
        { id: '2', phone: null },
      ],
    })
    const result = await resolveAudienceContacts(client, { type: 'all' }, ACCOUNT_ID)
    expect(result).toEqual([{ id: '1', phone: '+911234567890' }])
  })

  it('excludes marketing_opt_out contacts from an "all contacts" audience', async () => {
    const client = makeClient({
      contactsRows: [
        { id: '1', phone: '+911234567890', marketing_opt_out: false },
        { id: '2', phone: '+911234567891', marketing_opt_out: true },
      ],
    })
    const result = await resolveAudienceContacts(client, { type: 'all' }, ACCOUNT_ID)
    expect(result).toEqual([{ id: '1', phone: '+911234567890' }])
  })

  it('excludes marketing_opt_out contacts resolved via a tag filter', async () => {
    const client = makeClient({
      contactsRows: [
        { id: '1', phone: '+911234567890', marketing_opt_out: false },
        { id: '2', phone: '+911234567891', marketing_opt_out: true },
      ],
      tagMatches: [{ contact_id: '1' }, { contact_id: '2' }],
    })
    const result = await resolveAudienceContacts(client, { type: 'tags', tagIds: ['tag-1'] }, ACCOUNT_ID)
    expect(result).toEqual([{ id: '1', phone: '+911234567890' }])
  })

  it('excludes contacts with no opted_in consent record, even with phone and no opt-out', async () => {
    const client = makeClient({
      contactsRows: [
        { id: '1', phone: '+911234567890', marketing_opt_out: false },
        { id: '2', phone: '+911234567891', marketing_opt_out: false },
      ],
      optedInIds: ['1'], // contact 2 has no contact_consent row (or it's pending/no_response)
    })
    const result = await resolveAudienceContacts(client, { type: 'all' }, ACCOUNT_ID)
    expect(result).toEqual([{ id: '1', phone: '+911234567890' }])
  })

  it('excludes a pending/no_response contact resolved via a tag filter, not just opted_out ones', async () => {
    const client = makeClient({
      contactsRows: [
        { id: '1', phone: '+911234567890', marketing_opt_out: false },
        { id: '2', phone: '+911234567891', marketing_opt_out: false },
      ],
      tagMatches: [{ contact_id: '1' }, { contact_id: '2' }],
      optedInIds: ['1'],
    })
    const result = await resolveAudienceContacts(client, { type: 'tags', tagIds: ['tag-1'] }, ACCOUNT_ID)
    expect(result).toEqual([{ id: '1', phone: '+911234567890' }])
  })
})
