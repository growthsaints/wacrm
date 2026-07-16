import type { SupabaseClient } from '@supabase/supabase-js'
import { buildContactTimeline } from '@/lib/timeline/build-timeline'
import type { TimelineEvent } from '@/lib/timeline/types'

// ============================================================
// Business Workspace query layer — Phase 1 (Overview, Customer Hub,
// Customer 360). Every number here comes from data the CRM already
// tracks (contacts, conversations, messages, deals, contact_notes,
// notifications) via the SAME tables the existing Cloud API module
// reads — Business Workspace is a second lens over the same tenant
// data, not a parallel copy of it. Widgets the spec asks for that
// have no real backing signal yet (Follow-up Center, Calendar, Tasks,
// Team Workspace, AI Assistant — all later phases) are explicitly
// flagged as not-yet-available rather than shown as a fabricated zero.
// ============================================================

function startOfLocalDay(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function daysAgoIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

// ---------------------------------------------------------------
// Overview
// ---------------------------------------------------------------

export interface WorkspaceOverview {
  todaysCustomers: number
  openConversations: number
  openLeads: number
  assignedDeals: number
  unreadNotifications: number
  /** Average minutes between a customer's message and the next agent
   *  reply, over the last 7 days — null when there's no such pair yet. */
  avgResponseTimeMinutes: number | null
  recentNotes: Array<{
    id: string
    contactId: string
    contactName: string | null
    noteText: string
    createdAt: string
  }>
  activityTimeline: Array<{ id: string; text: string; at: string; href?: string }>
  /** User-facing labels for spec'd widgets with no real signal to back
   *  them yet — rendered as "coming soon" rather than a fake number. */
  notTrackedYet: string[]
}

export async function getWorkspaceOverview(
  db: SupabaseClient,
  accountId: string,
  userId: string,
): Promise<WorkspaceOverview> {
  const todayStart = startOfLocalDay()
  const sevenDaysAgo = daysAgoIso(7)

  const [
    { count: todaysCustomers },
    { count: openConversations },
    { data: openDeals },
    { count: unreadNotifications },
    { data: notesRows },
    { data: recentConvRows },
    { data: recentDealRows },
    { data: recentMessages },
  ] = await Promise.all([
    db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .gte('created_at', todayStart),
    db
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('status', 'open'),
    db
      .from('deals')
      .select('id, assigned_to')
      .eq('account_id', accountId)
      .eq('status', 'open'),
    db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .is('read_at', null),
    db
      .from('contact_notes')
      .select('id, contact_id, note_text, created_at, contacts(name)')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(5),
    db
      .from('conversations')
      .select('id, contact_id, created_at, contacts(name)')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(5),
    db
      .from('deals')
      .select('id, title, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(5),
    db
      .from('messages')
      .select('id, conversation_id, sender_type, created_at, conversations!inner(account_id)')
      .eq('conversations.account_id', accountId)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: true })
      .limit(2000),
  ])

  const openLeads = (openDeals ?? []).length
  const assignedDeals = (openDeals ?? []).filter((d) => !!(d as { assigned_to: string | null }).assigned_to).length

  // Average first-response time: for each conversation, the gap
  // between a customer message and the next agent message after it,
  // over the last 7 days. Bounded fetch (2000 rows) keeps this cheap;
  // a busy account's exact average may be sampled but stays honest.
  const byConversation = new Map<string, Array<{ sender_type: string; created_at: string }>>()
  for (const m of (recentMessages ?? []) as Array<{ conversation_id: string; sender_type: string; created_at: string }>) {
    const list = byConversation.get(m.conversation_id) ?? []
    list.push({ sender_type: m.sender_type, created_at: m.created_at })
    byConversation.set(m.conversation_id, list)
  }
  const gapsMinutes: number[] = []
  for (const msgs of byConversation.values()) {
    for (let i = 0; i < msgs.length - 1; i++) {
      if (msgs[i].sender_type === 'customer' && msgs[i + 1].sender_type === 'agent') {
        const gap = (new Date(msgs[i + 1].created_at).getTime() - new Date(msgs[i].created_at).getTime()) / 60000
        if (gap >= 0) gapsMinutes.push(gap)
      }
    }
  }
  const avgResponseTimeMinutes =
    gapsMinutes.length > 0 ? Math.round((gapsMinutes.reduce((a, b) => a + b, 0) / gapsMinutes.length) * 10) / 10 : null

  const recentNotes = ((notesRows ?? []) as unknown as Array<{
    id: string
    contact_id: string
    note_text: string
    created_at: string
    contacts: { name: string | null }[] | { name: string | null } | null
  }>).map((n) => {
    const contact = Array.isArray(n.contacts) ? n.contacts[0] : n.contacts
    return {
      id: n.id,
      contactId: n.contact_id,
      contactName: contact?.name ?? null,
      noteText: n.note_text,
      createdAt: n.created_at,
    }
  })

  const activity: Array<{ id: string; text: string; at: string; href?: string }> = []
  for (const c of (recentConvRows ?? []) as unknown as Array<{
    id: string
    contact_id: string
    created_at: string
    contacts: { name: string | null }[] | { name: string | null } | null
  }>) {
    const contact = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts
    activity.push({
      id: `conv-${c.id}`,
      text: `New conversation started${contact?.name ? ` with ${contact.name}` : ''}`,
      at: c.created_at,
      href: `/inbox?c=${c.id}`,
    })
  }
  for (const d of (recentDealRows ?? []) as Array<{ id: string; title: string; created_at: string }>) {
    activity.push({ id: `deal-${d.id}`, text: `Deal created: ${d.title}`, at: d.created_at, href: '/pipelines' })
  }
  for (const n of recentNotes) {
    activity.push({
      id: `note-${n.id}`,
      text: `Note added${n.contactName ? ` for ${n.contactName}` : ''}`,
      at: n.createdAt,
    })
  }
  activity.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))

  return {
    todaysCustomers: todaysCustomers ?? 0,
    openConversations: openConversations ?? 0,
    openLeads,
    assignedDeals,
    unreadNotifications: unreadNotifications ?? 0,
    avgResponseTimeMinutes,
    recentNotes,
    activityTimeline: activity.slice(0, 10),
    notTrackedYet: [
      'Pending Follow-ups (Follow-up Center)',
      'Upcoming Meetings (Calendar)',
      "Today's Tasks (Task Manager)",
      'Customer Satisfaction (no survey mechanism yet)',
      'Team Performance (Team Workspace)',
      'AI Suggestions (AI Assistant)',
    ],
  }
}

// ---------------------------------------------------------------
// Customer Hub
// ---------------------------------------------------------------

export interface CustomerHubFilters {
  search?: string
  source?: string
  priority?: string
  workspaceStatus?: string
  segment?: string
  tagId?: string
  assignedAgentId?: string
  page?: number
  pageSize?: number
}

export interface CustomerHubRow {
  id: string
  name: string | null
  phone: string
  email: string | null
  company: string | null
  source: string | null
  priority: string | null
  workspaceStatus: string | null
  segment: string | null
  assignedAgentId: string | null
  assignedAgentName: string | null
  tags: Array<{ id: string; name: string; color: string }>
  lastActivity: string | null
  customerScore: number | null
  createdAt: string
}

export interface CustomerHubResult {
  rows: CustomerHubRow[]
  totalCount: number
}

const DEFAULT_PAGE_SIZE = 25

export async function getCustomerHub(
  db: SupabaseClient,
  accountId: string,
  filters: CustomerHubFilters,
): Promise<CustomerHubResult> {
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
  const page = filters.page ?? 0
  const from = page * pageSize
  const to = from + pageSize - 1

  let query = db
    .from('contacts')
    .select('id, name, phone, email, company, source, priority, workspace_status, segment, assigned_agent_id, lead_score, created_at', {
      count: 'exact',
    })
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })

  if (filters.search) {
    const like = `%${filters.search}%`
    query = query.or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
  }
  if (filters.source) query = query.eq('source', filters.source)
  if (filters.priority) query = query.eq('priority', filters.priority)
  if (filters.workspaceStatus) query = query.eq('workspace_status', filters.workspaceStatus)
  if (filters.segment) query = query.eq('segment', filters.segment)
  if (filters.assignedAgentId) query = query.eq('assigned_agent_id', filters.assignedAgentId)

  let contactIds: string[] | null = null
  if (filters.tagId) {
    const { data: tagged } = await db.from('contact_tags').select('contact_id').eq('tag_id', filters.tagId)
    contactIds = (tagged ?? []).map((t) => (t as { contact_id: string }).contact_id)
    if (contactIds.length === 0) return { rows: [], totalCount: 0 }
    query = query.in('id', contactIds)
  }

  const { data: contacts, count, error } = await query.range(from, to)
  if (error) throw new Error(error.message)
  const rows = (contacts ?? []) as Array<{
    id: string
    name: string | null
    phone: string
    email: string | null
    company: string | null
    source: string | null
    priority: string | null
    workspace_status: string | null
    segment: string | null
    assigned_agent_id: string | null
    lead_score: number | null
    created_at: string
  }>

  if (rows.length === 0) return { rows: [], totalCount: count ?? 0 }

  const ids = rows.map((r) => r.id)
  const agentIds = [...new Set(rows.map((r) => r.assigned_agent_id).filter((v): v is string => !!v))]

  const [{ data: tagLinks }, { data: agents }, { data: convs }] = await Promise.all([
    db.from('contact_tags').select('contact_id, tags(id, name, color)').in('contact_id', ids),
    agentIds.length > 0
      ? db.from('profiles').select('id, full_name').in('id', agentIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
    db
      .from('conversations')
      .select('contact_id, last_message_at, created_at')
      .in('contact_id', ids)
      .order('last_message_at', { ascending: false }),
  ])

  const tagsByContact = new Map<string, Array<{ id: string; name: string; color: string }>>()
  for (const link of (tagLinks ?? []) as unknown as Array<{
    contact_id: string
    tags: { id: string; name: string; color: string }[] | { id: string; name: string; color: string } | null
  }>) {
    const tag = Array.isArray(link.tags) ? link.tags[0] : link.tags
    if (!tag) continue
    const list = tagsByContact.get(link.contact_id) ?? []
    list.push(tag)
    tagsByContact.set(link.contact_id, list)
  }

  const agentNameById = new Map((agents ?? []).map((a) => [(a as { id: string }).id, (a as { full_name: string }).full_name]))

  const lastActivityByContact = new Map<string, string>()
  for (const c of (convs ?? []) as Array<{ contact_id: string; last_message_at: string | null; created_at: string }>) {
    if (!lastActivityByContact.has(c.contact_id)) {
      lastActivityByContact.set(c.contact_id, c.last_message_at ?? c.created_at)
    }
  }

  return {
    rows: rows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      company: c.company,
      source: c.source,
      priority: c.priority,
      workspaceStatus: c.workspace_status,
      segment: c.segment,
      assignedAgentId: c.assigned_agent_id,
      assignedAgentName: c.assigned_agent_id ? agentNameById.get(c.assigned_agent_id) ?? null : null,
      tags: tagsByContact.get(c.id) ?? [],
      lastActivity: lastActivityByContact.get(c.id) ?? null,
      customerScore: c.lead_score,
      createdAt: c.created_at,
    })),
    totalCount: count ?? 0,
  }
}

export async function updateCustomerWorkspaceFields(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  updates: { priority?: string | null; workspaceStatus?: string | null; segment?: string | null; assignedAgentId?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if ('priority' in updates) patch.priority = updates.priority
  if ('workspaceStatus' in updates) patch.workspace_status = updates.workspaceStatus
  if ('segment' in updates) patch.segment = updates.segment
  if ('assignedAgentId' in updates) patch.assigned_agent_id = updates.assignedAgentId

  const { error } = await db.from('contacts').update(patch).eq('id', contactId).eq('account_id', accountId)
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------
// Customer 360
// ---------------------------------------------------------------

export type RiskLevel = 'low' | 'medium' | 'high'

export interface CustomerProfile {
  id: string
  name: string | null
  phone: string
  email: string | null
  company: string | null
  avatarUrl: string | null
  source: string | null
  priority: string | null
  workspaceStatus: string | null
  segment: string | null
  assignedAgentId: string | null
  assignedAgentName: string | null
  tags: Array<{ id: string; name: string; color: string }>
  notes: Array<{ id: string; noteText: string; createdAt: string }>
  deals: Array<{ id: string; title: string; value: number; currency: string | null; status: string; createdAt: string }>
  conversationCount: number
  lastActivity: string | null
  /** Computed from days since last activity — not a Meta or predictive
   *  signal. See computeRiskLevel(). */
  riskLevel: RiskLevel
  customerScore: number | null
  timeline: TimelineEvent[]
  createdAt: string
  /** Spec'd Customer 360 sections with no real data source yet. */
  notTrackedYet: string[]
}

export function computeRiskLevel(lastActivity: string | null): RiskLevel {
  if (!lastActivity) return 'high'
  const days = (Date.now() - new Date(lastActivity).getTime()) / 86400000
  if (days > 30) return 'high'
  if (days > 7) return 'medium'
  return 'low'
}

export async function getCustomerProfile(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<CustomerProfile | null> {
  const { data: contact, error } = await db
    .from('contacts')
    .select('id, name, phone, email, company, avatar_url, source, priority, workspace_status, segment, assigned_agent_id, lead_score, created_at')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !contact) return null

  const c = contact as {
    id: string
    name: string | null
    phone: string
    email: string | null
    company: string | null
    avatar_url: string | null
    source: string | null
    priority: string | null
    workspace_status: string | null
    segment: string | null
    assigned_agent_id: string | null
    lead_score: number | null
    created_at: string
  }

  const [tagLinksRes, notesRes, dealsRes, convsRes, agentRes, timeline] = await Promise.all([
    db.from('contact_tags').select('tags(id, name, color)').eq('contact_id', contactId),
    db.from('contact_notes').select('id, note_text, created_at').eq('contact_id', contactId).order('created_at', { ascending: false }),
    db
      .from('deals')
      .select('id, title, value, currency, status, created_at')
      .eq('contact_id', contactId)
      .eq('account_id', accountId)
      .order('created_at', { ascending: false }),
    db
      .from('conversations')
      .select('id, last_message_at, created_at')
      .eq('contact_id', contactId)
      .order('last_message_at', { ascending: false }),
    c.assigned_agent_id
      ? db.from('profiles').select('full_name').eq('id', c.assigned_agent_id).maybeSingle()
      : Promise.resolve({ data: null }),
    buildContactTimeline(db, contactId),
  ])

  const tags = ((tagLinksRes.data ?? []) as unknown as Array<{
    tags: { id: string; name: string; color: string }[] | { id: string; name: string; color: string } | null
  }>)
    .map((t) => (Array.isArray(t.tags) ? t.tags[0] : t.tags))
    .filter((t): t is { id: string; name: string; color: string } => !!t)

  const conversations = (convsRes.data ?? []) as Array<{ id: string; last_message_at: string | null; created_at: string }>
  const lastActivity =
    conversations.length > 0
      ? conversations.reduce<string | null>((latest, conv) => {
          const at = conv.last_message_at ?? conv.created_at
          return !latest || at > latest ? at : latest
        }, null)
      : null

  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    company: c.company,
    avatarUrl: c.avatar_url,
    source: c.source,
    priority: c.priority,
    workspaceStatus: c.workspace_status,
    segment: c.segment,
    assignedAgentId: c.assigned_agent_id,
    assignedAgentName: (agentRes.data as { full_name: string } | null)?.full_name ?? null,
    tags,
    notes: ((notesRes.data ?? []) as Array<{ id: string; note_text: string; created_at: string }>).map((n) => ({
      id: n.id,
      noteText: n.note_text,
      createdAt: n.created_at,
    })),
    deals: ((dealsRes.data ?? []) as Array<{
      id: string
      title: string
      value: number
      currency: string | null
      status: string
      created_at: string
    }>).map((d) => ({
      id: d.id,
      title: d.title,
      value: d.value,
      currency: d.currency,
      status: d.status,
      createdAt: d.created_at,
    })),
    conversationCount: conversations.length,
    lastActivity,
    riskLevel: computeRiskLevel(lastActivity),
    customerScore: c.lead_score,
    timeline,
    createdAt: c.created_at,
    notTrackedYet: [
      'Invoices & Payments (no billing-per-customer module yet)',
      'Documents beyond chat attachments',
      'Next Follow-up (Follow-up Center)',
      'AI Summary (AI Assistant)',
    ],
  }
}

export async function addContactNote(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  contactId: string,
  noteText: string,
): Promise<{ id: string; noteText: string; createdAt: string }> {
  const { data, error } = await db
    .from('contact_notes')
    .insert({ account_id: accountId, contact_id: contactId, user_id: userId, note_text: noteText })
    .select('id, note_text, created_at')
    .single()
  if (error) throw new Error(error.message)
  const row = data as { id: string; note_text: string; created_at: string }
  return { id: row.id, noteText: row.note_text, createdAt: row.created_at }
}
