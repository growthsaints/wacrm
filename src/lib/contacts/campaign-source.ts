// Derives a contact's most recent "Campaign Source" from
// `broadcast_recipients` — the existing Broadcasts feature already
// records exactly which campaign reached which contact, so this reads
// that instead of adding a new column to track it separately.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface CampaignSource {
  broadcastId: string
  broadcastName: string
  sentAt: string | null
}

export async function getContactCampaignSource(
  db: SupabaseClient,
  contactId: string,
): Promise<CampaignSource | null> {
  const { data } = await db
    .from('broadcast_recipients')
    .select('sent_at, created_at, broadcast:broadcasts(id, name)')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  const row = data as unknown as {
    sent_at: string | null
    created_at: string
    broadcast: { id: string; name: string }[] | { id: string; name: string } | null
  }
  const broadcast = Array.isArray(row.broadcast) ? row.broadcast[0] : row.broadcast
  if (!broadcast) return null

  return {
    broadcastId: broadcast.id,
    broadcastName: broadcast.name,
    sentAt: row.sent_at ?? row.created_at,
  }
}
