// ============================================================
// Resolves an audience_filter (same all/tags/custom_field shape
// broadcasts use — see hooks/use-broadcast-sending.ts's
// AudienceConfig) into a flat contact_id/phone list, server-side. CSV
// audiences aren't supported here — a Custom Audience is a saved,
// re-syncable CRM segment, not a one-off pasted list.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

export type AudienceFilterType = 'all' | 'tags' | 'custom_field'

export interface AudienceFilter {
  type: AudienceFilterType
  tagIds?: string[]
  customField?: {
    fieldId: string
    operator: 'is' | 'is_not' | 'contains'
    value: string
  }
}

export interface ResolvedContact {
  id: string
  phone: string
}

const FETCH_CHUNK = 200
/** Supabase/PostgREST caps an unbounded .select() at this many rows by
 *  default — every query here that could plausibly return more than
 *  that for a real account (all contacts, tag matches, custom-field
 *  matches) MUST paginate with .range(), or a large CRM silently gets
 *  truncated (e.g. an "all contacts" audience built from 5,500 real
 *  contacts would otherwise only ever pick up the first 1,000). */
const PAGE_SIZE = 1000

/** Runs `query(from, to)` repeatedly with an advancing .range() until a page comes back short, collecting every row regardless of the default row cap. */
async function fetchAllPages<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) return out
    from += PAGE_SIZE
  }
}

/** Batched by id — a single .in() call with a huge id list can build a request URL past the server's length limit (same failure mode fixed for broadcast audiences). */
async function fetchContactPhonesByIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<ResolvedContact[]> {
  const out: ResolvedContact[] = []
  for (let i = 0; i < ids.length; i += FETCH_CHUNK) {
    const chunk = ids.slice(i, i + FETCH_CHUNK)
    const { data, error } = await supabase.from('contacts').select('id, phone, marketing_opt_out').in('id', chunk)
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`)
    for (const row of (data ?? []) as { id: string; phone: string | null; marketing_opt_out: boolean | null }[]) {
      if (row.phone && !row.marketing_opt_out) out.push({ id: row.id, phone: row.phone })
    }
  }
  return out
}

/** Contacts who've opted out of marketing must never be uploaded to a
 *  Custom Audience — same exclusion broadcasts already apply before
 *  sending (see hooks/use-broadcast-sending.ts), applied here too so
 *  the Ads path can't silently bypass it. */
export async function resolveAudienceContacts(
  supabase: SupabaseClient,
  filter: AudienceFilter,
): Promise<ResolvedContact[]> {
  if (filter.type === 'all') {
    const rows = await fetchAllPages<{ id: string; phone: string | null; marketing_opt_out: boolean | null }>(
      (from, to) => supabase.from('contacts').select('id, phone, marketing_opt_out').range(from, to),
    )
    return rows
      .filter((c) => Boolean(c.phone) && !c.marketing_opt_out)
      .map((c) => ({ id: c.id, phone: c.phone as string }))
  }

  if (filter.type === 'tags') {
    const tagIds = filter.tagIds ?? []
    if (tagIds.length === 0) return []
    const contactTags = await fetchAllPages<{ contact_id: string }>((from, to) =>
      supabase.from('contact_tags').select('contact_id').in('tag_id', tagIds).range(from, to),
    )
    const uniqueIds = [...new Set(contactTags.map((r) => r.contact_id))]
    return fetchContactPhonesByIds(supabase, uniqueIds)
  }

  if (filter.type === 'custom_field' && filter.customField) {
    const { fieldId, operator, value } = filter.customField
    const matches = await fetchAllPages<{ contact_id: string }>((from, to) => {
      let query = supabase.from('contact_custom_values').select('contact_id').eq('custom_field_id', fieldId)
      if (operator === 'is') query = query.eq('value', value)
      else if (operator === 'is_not') query = query.neq('value', value)
      else if (operator === 'contains') query = query.ilike('value', `%${value}%`)
      return query.range(from, to)
    })
    const uniqueIds = [...new Set(matches.map((r) => r.contact_id))]
    return fetchContactPhonesByIds(supabase, uniqueIds)
  }

  return []
}
