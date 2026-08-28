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

/** Batched by id — a single .in() call with a huge id list can build a request URL past the server's length limit (same failure mode fixed for broadcast audiences). */
async function fetchContactPhonesByIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<ResolvedContact[]> {
  const out: ResolvedContact[] = []
  for (let i = 0; i < ids.length; i += FETCH_CHUNK) {
    const chunk = ids.slice(i, i + FETCH_CHUNK)
    const { data, error } = await supabase.from('contacts').select('id, phone').in('id', chunk)
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`)
    for (const row of (data ?? []) as { id: string; phone: string | null }[]) {
      if (row.phone) out.push({ id: row.id, phone: row.phone })
    }
  }
  return out
}

export async function resolveAudienceContacts(
  supabase: SupabaseClient,
  filter: AudienceFilter,
): Promise<ResolvedContact[]> {
  if (filter.type === 'all') {
    const { data, error } = await supabase.from('contacts').select('id, phone')
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`)
    return ((data ?? []) as { id: string; phone: string | null }[]).filter(
      (c): c is ResolvedContact => Boolean(c.phone),
    )
  }

  if (filter.type === 'tags') {
    const tagIds = filter.tagIds ?? []
    if (tagIds.length === 0) return []
    const { data: contactTags, error } = await supabase
      .from('contact_tags')
      .select('contact_id')
      .in('tag_id', tagIds)
    if (error) throw new Error(`Failed to fetch contact tags: ${error.message}`)
    const uniqueIds = [...new Set((contactTags ?? []).map((r) => r.contact_id as string))]
    return fetchContactPhonesByIds(supabase, uniqueIds)
  }

  if (filter.type === 'custom_field' && filter.customField) {
    const { fieldId, operator, value } = filter.customField
    let query = supabase.from('contact_custom_values').select('contact_id').eq('custom_field_id', fieldId)
    if (operator === 'is') query = query.eq('value', value)
    else if (operator === 'is_not') query = query.neq('value', value)
    else if (operator === 'contains') query = query.ilike('value', `%${value}%`)
    const { data: matches, error } = await query
    if (error) throw new Error(`Custom-field filter failed: ${error.message}`)
    const uniqueIds = [...new Set((matches ?? []).map((r) => r.contact_id as string))]
    return fetchContactPhonesByIds(supabase, uniqueIds)
  }

  return []
}
