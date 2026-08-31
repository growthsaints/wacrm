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

  it('excludes marketing_opt_out contacts from an "all contacts" audience', async () => {
    const range = vi.fn(() =>
      Promise.resolve({
        data: [
          { id: '1', phone: '+911234567890', marketing_opt_out: false },
          { id: '2', phone: '+911234567891', marketing_opt_out: true },
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

  it('excludes marketing_opt_out contacts resolved via a tag filter', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'contact_tags') {
        return {
          select: () => ({
            in: () => ({
              range: vi.fn(() =>
                Promise.resolve({ data: [{ contact_id: '1' }, { contact_id: '2' }], error: null }),
              ),
            }),
          }),
        }
      }
      if (table === 'contacts') {
        return {
          select: () => ({
            in: vi.fn(() =>
              Promise.resolve({
                data: [
                  { id: '1', phone: '+911234567890', marketing_opt_out: false },
                  { id: '2', phone: '+911234567891', marketing_opt_out: true },
                ],
                error: null,
              }),
            ),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    })
    const client = { from } as unknown as SupabaseClient

    const result = await resolveAudienceContacts(client, { type: 'tags', tagIds: ['tag-1'] })
    expect(result).toEqual([{ id: '1', phone: '+911234567890' }])
  })
})
