import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveAudienceContacts } from './audience'

/** Mimics Supabase/PostgREST's real default row cap — a .range() request
 *  only ever gets back at most 1000 rows per page, regardless of how
 *  many rows actually match, so a caller MUST page through with
 *  .range() to see everything. This is the exact behavior that
 *  silently truncated a 5,500-contact "all contacts" audience down to
 *  1,000 before resolveAudienceContacts paginated. */
function makeContactsClient(totalContacts: number): SupabaseClient {
  const range = vi.fn((start: number, end: number) => {
    const cappedEnd = Math.min(end, start + 999)
    const rows: { id: string; phone: string }[] = []
    for (let i = start; i <= cappedEnd && i < totalContacts; i++) {
      rows.push({ id: `id-${i}`, phone: `+9190000${String(i).padStart(4, '0')}` })
    }
    return Promise.resolve({ data: rows, error: null })
  })
  const select = vi.fn(() => ({ range }))
  const from = vi.fn(() => ({ select }))
  return { from } as unknown as SupabaseClient
}

describe('resolveAudienceContacts', () => {
  it('paginates past the default 1,000-row cap for a large CRM', async () => {
    const client = makeContactsClient(5500)
    const result = await resolveAudienceContacts(client, { type: 'all' })
    expect(result).toHaveLength(5500)
    expect(result[0]).toEqual({ id: 'id-0', phone: '+91900000000' })
    expect(result[5499]).toEqual({ id: 'id-5499', phone: '+91900005499' })
  })

  it('returns everything for a count that fits in one page', async () => {
    const client = makeContactsClient(250)
    const result = await resolveAudienceContacts(client, { type: 'all' })
    expect(result).toHaveLength(250)
  })

  it('drops contacts with no phone number', async () => {
    const range = vi.fn(() =>
      Promise.resolve({
        data: [
          { id: '1', phone: '+911234567890' },
          { id: '2', phone: null },
        ],
        error: null,
      }),
    )
    const select = vi.fn(() => ({ range }))
    const from = vi.fn(() => ({ select }))
    const client = { from } as unknown as SupabaseClient

    const result = await resolveAudienceContacts(client, { type: 'all' })
    expect(result).toEqual([{ id: '1', phone: '+911234567890' }])
  })
})
