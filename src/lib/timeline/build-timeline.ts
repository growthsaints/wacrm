// Builds the activity timeline for a single contact: Lead Created →
// Conversation Started → Template/Broadcast Sent → Agent Assigned →
// Tag Added → Notes → Orders (deals) — merged and sorted, same
// merge-and-sort approach as the dashboard's `loadActivity`
// (src/lib/dashboard/queries.ts), just scoped to one contact instead
// of the whole account.
//
// RLS scopes every query to the caller's account automatically, so
// callers only need to pass the contact id.

import type { SupabaseClient } from '@supabase/supabase-js'
import { contactSourceLabel } from '@/lib/contacts/source-label'
import type { Contact } from '@/types'
import type { TimelineEvent } from './types'

type DB = SupabaseClient

export async function buildContactTimeline(
  db: DB,
  contactId: string,
  limit = 100,
): Promise<TimelineEvent[]> {
  const [contactRes, conversationsRes, tagsRes, notesRes, dealsRes, recipientsRes, ordersRes] =
    await Promise.all([
      db
        .from('contacts')
        .select('id, name, phone, source, created_at')
        .eq('id', contactId)
        .maybeSingle(),
      db
        .from('conversations')
        .select('id, status, assigned_agent_id, assigned_at, created_at')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true }),
      db
        .from('contact_tags')
        .select('id, created_at, tags(name)')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(20),
      db
        .from('contact_notes')
        .select('id, note_text, created_at')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(20),
      db
        .from('deals')
        .select('id, title, value, created_at')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(20),
      db
        .from('broadcast_recipients')
        .select('id, status, sent_at, created_at, broadcast:broadcasts(id, name, template_name)')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(20),
      db
        .from('commerce_orders')
        .select('id, order_number, status, total, currency, placed_at, created_at')
        .eq('contact_id', contactId)
        .order('placed_at', { ascending: false })
        .limit(20),
    ])

  const events: TimelineEvent[] = []

  const contact = contactRes.data as
    | { id: string; name: string | null; phone: string; source: string | null; created_at: string }
    | null

  if (contact) {
    events.push({
      id: `lead-${contact.id}`,
      kind: 'lead_created',
      text: contact.source
        ? `Lead created via ${contactSourceLabel(contact.source as Contact['source'])}`
        : 'Lead created',
      at: contact.created_at,
    })
  }

  const conversations = (conversationsRes.data ?? []) as Array<{
    id: string
    status: string
    assigned_agent_id: string | null
    assigned_at: string | null
    created_at: string
  }>
  for (const c of conversations) {
    events.push({
      id: `conv-${c.id}`,
      kind: 'conversation_started',
      text: 'Conversation started',
      at: c.created_at,
      href: `/inbox?c=${c.id}`,
    })
    if (c.assigned_at) {
      events.push({
        id: `assign-${c.id}`,
        kind: 'agent_assigned',
        text: 'Conversation assigned to an agent',
        at: c.assigned_at,
        href: `/inbox?c=${c.id}`,
      })
    }
  }

  const tags = (tagsRes.data ?? []) as unknown as Array<{
    id: string
    created_at: string
    tags: { name: string }[] | { name: string } | null
  }>
  for (const t of tags) {
    const tag = Array.isArray(t.tags) ? t.tags[0] : t.tags
    if (!tag) continue
    events.push({
      id: `tag-${t.id}`,
      kind: 'tag_added',
      text: `Tag added: ${tag.name}`,
      at: t.created_at,
    })
  }

  const notes = (notesRes.data ?? []) as Array<{ id: string; note_text: string; created_at: string }>
  for (const n of notes) {
    events.push({
      id: `note-${n.id}`,
      kind: 'note',
      text: truncateNote(n.note_text),
      at: n.created_at,
    })
  }

  const deals = (dealsRes.data ?? []) as Array<{ id: string; title: string; value: number | null; created_at: string }>
  for (const d of deals) {
    events.push({
      id: `deal-${d.id}`,
      kind: 'deal',
      text: `Deal created: ${d.title}`,
      at: d.created_at,
      href: '/pipelines',
    })
  }

  const recipients = (recipientsRes.data ?? []) as unknown as Array<{
    id: string
    status: string
    sent_at: string | null
    created_at: string
    broadcast: { id: string; name: string; template_name: string }[] | { id: string; name: string; template_name: string } | null
  }>
  for (const r of recipients) {
    const broadcast = Array.isArray(r.broadcast) ? r.broadcast[0] : r.broadcast
    if (!broadcast) continue
    events.push({
      id: `bcast-${r.id}`,
      kind: 'broadcast',
      text:
        r.status === 'failed'
          ? `Broadcast "${broadcast.name}" failed to send`
          : `Broadcast "${broadcast.name}" sent (${broadcast.template_name})`,
      at: r.sent_at ?? r.created_at,
      href: `/broadcasts/${broadcast.id}`,
    })
  }

  const orders = (ordersRes.data ?? []) as Array<{
    id: string
    order_number: string | null
    status: string
    total: number
    currency: string
    placed_at: string | null
    created_at: string
  }>
  for (const o of orders) {
    events.push({
      id: `order-${o.id}`,
      kind: 'order',
      text: `Order ${o.order_number ?? o.id.slice(0, 8)} ${o.status} — ${o.currency} ${o.total.toFixed(2)}`,
      at: o.placed_at ?? o.created_at,
    })
  }

  return events
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit)
}

function truncateNote(text: string, max = 140): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `Note: ${trimmed.slice(0, max)}…` : `Note: ${trimmed}`
}
