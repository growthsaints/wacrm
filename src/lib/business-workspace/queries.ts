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

// ---------------------------------------------------------------
// Notes (account-wide list) — Phase 2
// ---------------------------------------------------------------

export interface NotesListRow {
  id: string
  contactId: string
  contactName: string | null
  contactPhone: string | null
  noteText: string
  createdAt: string
}

export interface NotesListResult {
  rows: NotesListRow[]
  totalCount: number
}

export async function getNotesList(
  db: SupabaseClient,
  accountId: string,
  filters: { search?: string; page?: number; pageSize?: number },
): Promise<NotesListResult> {
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
  const page = filters.page ?? 0
  const from = page * pageSize
  const to = from + pageSize - 1

  let query = db
    .from('contact_notes')
    .select('id, contact_id, note_text, created_at, contacts(name, phone)', { count: 'exact' })
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })

  if (filters.search) {
    query = query.ilike('note_text', `%${filters.search}%`)
  }

  const { data, count, error } = await query.range(from, to)
  if (error) throw new Error(error.message)

  const rows = ((data ?? []) as unknown as Array<{
    id: string
    contact_id: string
    note_text: string
    created_at: string
    contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null
  }>).map((n) => {
    const contact = Array.isArray(n.contacts) ? n.contacts[0] : n.contacts
    return {
      id: n.id,
      contactId: n.contact_id,
      contactName: contact?.name ?? null,
      contactPhone: contact?.phone ?? null,
      noteText: n.note_text,
      createdAt: n.created_at,
    }
  })

  return { rows, totalCount: count ?? 0 }
}

// ---------------------------------------------------------------
// Deals (flat, filterable list) — Phase 2. Same `deals` table the
// existing Pipelines Kanban board uses; this is a second, list-shaped
// lens over it (sortable/filterable across every stage at once)
// rather than a parallel deals schema.
// ---------------------------------------------------------------

export interface DealsListRow {
  id: string
  title: string
  value: number
  currency: string | null
  status: string
  stageName: string | null
  contactId: string
  contactName: string | null
  assignedToId: string | null
  assignedToName: string | null
  expectedCloseDate: string | null
  createdAt: string
}

export interface DealsListResult {
  rows: DealsListRow[]
  totalCount: number
}

export async function getDealsList(
  db: SupabaseClient,
  accountId: string,
  filters: { search?: string; status?: string; assignedToId?: string; page?: number; pageSize?: number },
): Promise<DealsListResult> {
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
  const page = filters.page ?? 0
  const from = page * pageSize
  const to = from + pageSize - 1

  let query = db
    .from('deals')
    .select(
      'id, title, value, currency, status, expected_close_date, created_at, assigned_to, contact_id, pipeline_stages(name), contacts(name)',
      { count: 'exact' },
    )
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })

  if (filters.search) query = query.ilike('title', `%${filters.search}%`)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.assignedToId) query = query.eq('assigned_to', filters.assignedToId)

  const { data, count, error } = await query.range(from, to)
  if (error) throw new Error(error.message)

  const dealRows = (data ?? []) as unknown as Array<{
    id: string
    title: string
    value: number
    currency: string | null
    status: string
    expected_close_date: string | null
    created_at: string
    assigned_to: string | null
    contact_id: string
    pipeline_stages: { name: string }[] | { name: string } | null
    contacts: { name: string | null }[] | { name: string | null } | null
  }>

  const agentIds = [...new Set(dealRows.map((d) => d.assigned_to).filter((v): v is string => !!v))]
  const { data: agents } =
    agentIds.length > 0
      ? await db.from('profiles').select('id, full_name').in('id', agentIds)
      : { data: [] as Array<{ id: string; full_name: string }> }
  const agentNameById = new Map((agents ?? []).map((a) => [a.id, a.full_name]))

  const rows = dealRows.map((d) => {
    const stage = Array.isArray(d.pipeline_stages) ? d.pipeline_stages[0] : d.pipeline_stages
    const contact = Array.isArray(d.contacts) ? d.contacts[0] : d.contacts
    return {
      id: d.id,
      title: d.title,
      value: d.value,
      currency: d.currency,
      status: d.status,
      stageName: stage?.name ?? null,
      contactId: d.contact_id,
      contactName: contact?.name ?? null,
      assignedToId: d.assigned_to,
      assignedToName: d.assigned_to ? agentNameById.get(d.assigned_to) ?? null : null,
      expectedCloseDate: d.expected_close_date,
      createdAt: d.created_at,
    }
  })

  return { rows, totalCount: count ?? 0 }
}

// ---------------------------------------------------------------
// Team Workspace — Roster + live presence (reuses member_presence,
// migration 024) + a simple, real weekly performance count.
// Departments and Internal Chat live further down this file
// (migration 051). Announcements still aren't built — a genuinely
// separate feature (broadcast-style posts, not 1:1/group chat) left
// for a later phase.
// ---------------------------------------------------------------

export interface TeamMemberRow {
  userId: string
  fullName: string | null
  email: string
  accountRole: string
  presenceStatus: 'online' | 'away' | 'offline'
  lastSeenAt: string | null
  conversationsClosedThisWeek: number
  dealsWonThisWeek: number
}

export interface TeamWorkspaceResult {
  members: TeamMemberRow[]
  notTrackedYet: string[]
}

const PRESENCE_ONLINE_WINDOW_MINUTES = 2
const PRESENCE_AWAY_WINDOW_MINUTES = 10

function derivePresenceStatus(status: string | undefined, lastSeenAt: string | undefined): 'online' | 'away' | 'offline' {
  if (!lastSeenAt) return 'offline'
  const minutesAgo = (Date.now() - new Date(lastSeenAt).getTime()) / 60000
  if (status === 'online' && minutesAgo <= PRESENCE_ONLINE_WINDOW_MINUTES) return 'online'
  if (minutesAgo <= PRESENCE_AWAY_WINDOW_MINUTES) return 'away'
  return 'offline'
}

export async function getTeamWorkspace(db: SupabaseClient, accountId: string): Promise<TeamWorkspaceResult> {
  const weekAgo = daysAgoIso(7)

  const [{ data: profiles }, { data: presence }, { data: closedConvs }, { data: wonDeals }] = await Promise.all([
    db.from('profiles').select('id, user_id, full_name, email, account_role').eq('account_id', accountId),
    db.from('member_presence').select('user_id, status, last_seen_at').eq('account_id', accountId),
    db
      .from('conversations')
      .select('assigned_agent_id')
      .eq('account_id', accountId)
      .eq('status', 'closed')
      .gte('updated_at', weekAgo),
    db
      .from('deals')
      .select('assigned_to')
      .eq('account_id', accountId)
      .eq('status', 'won')
      .gte('updated_at', weekAgo),
  ])

  const presenceByUser = new Map(
    ((presence ?? []) as Array<{ user_id: string; status: string; last_seen_at: string }>).map((p) => [p.user_id, p]),
  )

  const closedCountByAgent = new Map<string, number>()
  for (const c of (closedConvs ?? []) as Array<{ assigned_agent_id: string | null }>) {
    if (!c.assigned_agent_id) continue
    closedCountByAgent.set(c.assigned_agent_id, (closedCountByAgent.get(c.assigned_agent_id) ?? 0) + 1)
  }

  const wonCountByAgent = new Map<string, number>()
  for (const d of (wonDeals ?? []) as Array<{ assigned_to: string | null }>) {
    if (!d.assigned_to) continue
    wonCountByAgent.set(d.assigned_to, (wonCountByAgent.get(d.assigned_to) ?? 0) + 1)
  }

  const members = ((profiles ?? []) as Array<{
    id: string
    user_id: string
    full_name: string | null
    email: string
    account_role: string
  }>).map((p) => {
    const pres = presenceByUser.get(p.user_id)
    return {
      userId: p.user_id,
      fullName: p.full_name,
      email: p.email,
      accountRole: p.account_role,
      presenceStatus: derivePresenceStatus(pres?.status, pres?.last_seen_at),
      lastSeenAt: pres?.last_seen_at ?? null,
      // conversations.assigned_agent_id stores auth.users.id (= profiles.user_id);
      // deals.assigned_to stores profiles.id — two different id spaces (see
      // migration 002 vs conversation-list.tsx's `assigned_agent_id === user.id`).
      conversationsClosedThisWeek: closedCountByAgent.get(p.user_id) ?? 0,
      dealsWonThisWeek: wonCountByAgent.get(p.id) ?? 0,
    }
  })

  return {
    members,
    notTrackedYet: ['Announcements'],
  }
}

// ---------------------------------------------------------------
// Shared Inbox — Phase 3. A management lens over `conversations`
// (assign/pin/status/last-message), not a second live-chat engine —
// "Open" links back into the existing, already-working Inbox for the
// actual message thread. Internal Notes/Mentions have no backing
// column/table yet; the per-contact Notes page is the closest real
// substitute today.
// ---------------------------------------------------------------

export interface SharedInboxRow {
  id: string
  contactId: string
  contactName: string | null
  contactPhone: string
  status: string
  isPinned: boolean
  assignedAgentId: string | null
  assignedAgentName: string | null
  lastMessageText: string | null
  lastMessageAt: string | null
  unreadCount: number
  /** 'personal_whatsapp' rows come from the QR-linked connection —
   *  read-only here, reply happens in Personal Inbox, never through
   *  the Cloud API send path this page's "Open" link normally uses. */
  channel: 'cloud_api' | 'personal_whatsapp'
}

export interface SharedInboxResult {
  rows: SharedInboxRow[]
  totalCount: number
  notTrackedYet: string[]
}

export async function getSharedInbox(
  db: SupabaseClient,
  accountId: string,
  filters: { status?: string; assignedAgentId?: string; pinnedOnly?: boolean; search?: string; page?: number; pageSize?: number },
): Promise<SharedInboxResult> {
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
  const page = filters.page ?? 0
  const from = page * pageSize
  const to = from + pageSize - 1

  let query = db
    .from('conversations')
    .select('id, contact_id, status, is_pinned, assigned_agent_id, last_message_text, last_message_at, unread_count, contacts(name, phone)', {
      count: 'exact',
    })
    .eq('account_id', accountId)
    .order('is_pinned', { ascending: false })
    .order('last_message_at', { ascending: false, nullsFirst: false })

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.assignedAgentId) query = query.eq('assigned_agent_id', filters.assignedAgentId)
  if (filters.pinnedOnly) query = query.eq('is_pinned', true)

  const { data, count, error } = await query.range(from, to)
  if (error) throw new Error(error.message)

  let rows = (data ?? []) as unknown as Array<{
    id: string
    contact_id: string
    status: string
    is_pinned: boolean
    assigned_agent_id: string | null
    last_message_text: string | null
    last_message_at: string | null
    unread_count: number
    contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null
  }>

  if (filters.search) {
    const term = filters.search.toLowerCase()
    rows = rows.filter((r) => {
      const contact = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts
      return (contact?.name ?? '').toLowerCase().includes(term) || (contact?.phone ?? '').includes(term)
    })
  }

  const agentUserIds = [...new Set(rows.map((r) => r.assigned_agent_id).filter((v): v is string => !!v))]
  const { data: agents } =
    agentUserIds.length > 0
      ? await db.from('profiles').select('user_id, full_name').in('user_id', agentUserIds)
      : { data: [] as Array<{ user_id: string; full_name: string }> }
  const agentNameByUserId = new Map((agents ?? []).map((a) => [a.user_id, a.full_name]))

  const cloudApiRows: SharedInboxRow[] = rows.map((r) => {
    const contact = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts
    return {
      id: r.id,
      contactId: r.contact_id,
      contactName: contact?.name ?? null,
      contactPhone: contact?.phone ?? '',
      status: r.status,
      isPinned: r.is_pinned,
      assignedAgentId: r.assigned_agent_id,
      assignedAgentName: r.assigned_agent_id ? agentNameByUserId.get(r.assigned_agent_id) ?? null : null,
      lastMessageText: r.last_message_text,
      lastMessageAt: r.last_message_at,
      unreadCount: r.unread_count,
      channel: 'cloud_api',
    }
  })

  // Personal WhatsApp conversations have no status/pinned/assigned-
  // agent concept, so they only appear on the unfiltered first page
  // (or when just searching by name/phone) — filtering by any of
  // those Cloud-API-specific attributes naturally excludes them.
  let personalRows: SharedInboxRow[] = []
  let personalTotalCount = 0
  if (page === 0 && !filters.status && !filters.assignedAgentId && !filters.pinnedOnly) {
    const { data: personalConvs, count: pCount } = await db
      .from('workspace_whatsapp_personal_conversations')
      .select('id, last_message_text, last_message_at, unread_count, workspace_whatsapp_personal_contacts(phone_number, display_name)', {
        count: 'exact',
      })
      .eq('account_id', accountId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(pageSize)

    personalTotalCount = pCount ?? 0
    personalRows = ((personalConvs ?? []) as unknown as Array<{
      id: string
      last_message_text: string | null
      last_message_at: string | null
      unread_count: number
      workspace_whatsapp_personal_contacts:
        | { phone_number: string; display_name: string | null }[]
        | { phone_number: string; display_name: string | null }
        | null
    }>)
      .map((c) => {
        const contact = Array.isArray(c.workspace_whatsapp_personal_contacts)
          ? c.workspace_whatsapp_personal_contacts[0]
          : c.workspace_whatsapp_personal_contacts
        return {
          id: c.id,
          contactId: c.id,
          contactName: contact?.display_name ?? null,
          contactPhone: contact?.phone_number ?? '',
          status: 'open',
          isPinned: false,
          assignedAgentId: null,
          assignedAgentName: null,
          lastMessageText: c.last_message_text,
          lastMessageAt: c.last_message_at,
          unreadCount: c.unread_count,
          channel: 'personal_whatsapp' as const,
        }
      })
      .filter((r) => {
        if (!filters.search) return true
        const term = filters.search.toLowerCase()
        return (r.contactName ?? '').toLowerCase().includes(term) || r.contactPhone.includes(term)
      })
  }

  const merged = [...cloudApiRows, ...personalRows].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
    const aAt = a.lastMessageAt ?? ''
    const bAt = b.lastMessageAt ?? ''
    return aAt > bAt ? -1 : aAt < bAt ? 1 : 0
  })

  return {
    rows: merged.slice(0, pageSize),
    totalCount: (count ?? 0) + personalTotalCount,
    notTrackedYet: ['Internal Notes (use the Notes page against the contact today)', 'Mentions'],
  }
}

// ---------------------------------------------------------------
// Follow-up Center + Calendar — Phase 3. Share `workspace_scheduled_
// items` (migration 047): Follow-up Center filters to
// follow_up/reminder/task; Calendar shows every type across a date
// range. Same table, two lenses — not a fork.
// ---------------------------------------------------------------

export type ScheduledItemType = 'meeting' | 'appointment' | 'callback' | 'task' | 'follow_up' | 'event' | 'birthday' | 'reminder'

export interface ScheduledItemRow {
  id: string
  title: string
  itemType: ScheduledItemType
  dueAt: string
  isRecurring: boolean
  priority: string | null
  status: string
  assignedToId: string | null
  assignedToName: string | null
  contactId: string | null
  contactName: string | null
  notes: string | null
  createdAt: string
}

async function hydrateScheduledItems(
  db: SupabaseClient,
  rows: Array<{
    id: string
    title: string
    item_type: ScheduledItemType
    due_at: string
    is_recurring: boolean
    priority: string | null
    status: string
    assigned_to: string | null
    contact_id: string | null
    notes: string | null
    created_at: string
  }>,
): Promise<ScheduledItemRow[]> {
  const agentIds = [...new Set(rows.map((r) => r.assigned_to).filter((v): v is string => !!v))]
  const contactIds = [...new Set(rows.map((r) => r.contact_id).filter((v): v is string => !!v))]

  const [{ data: agents }, { data: contacts }] = await Promise.all([
    agentIds.length > 0
      ? db.from('profiles').select('id, full_name').in('id', agentIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
    contactIds.length > 0
      ? db.from('contacts').select('id, name').in('id', contactIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string | null }> }),
  ])
  const agentNameById = new Map((agents ?? []).map((a) => [a.id, a.full_name]))
  const contactNameById = new Map((contacts ?? []).map((c) => [c.id, c.name]))

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    itemType: r.item_type,
    dueAt: r.due_at,
    isRecurring: r.is_recurring,
    priority: r.priority,
    status: r.status,
    assignedToId: r.assigned_to,
    assignedToName: r.assigned_to ? agentNameById.get(r.assigned_to) ?? null : null,
    contactId: r.contact_id,
    contactName: r.contact_id ? contactNameById.get(r.contact_id) ?? null : null,
    notes: r.notes,
    createdAt: r.created_at,
  }))
}

export async function getScheduledItems(
  db: SupabaseClient,
  accountId: string,
  filters: { types?: ScheduledItemType[]; status?: string; fromDate?: string; toDate?: string; page?: number; pageSize?: number },
): Promise<{ rows: ScheduledItemRow[]; totalCount: number }> {
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
  const page = filters.page ?? 0
  const from = page * pageSize
  const to = from + pageSize - 1

  let query = db
    .from('workspace_scheduled_items')
    .select('id, title, item_type, due_at, is_recurring, priority, status, assigned_to, contact_id, notes, created_at', {
      count: 'exact',
    })
    .eq('account_id', accountId)
    .order('due_at', { ascending: true })

  if (filters.types && filters.types.length > 0) query = query.in('item_type', filters.types)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.fromDate) query = query.gte('due_at', filters.fromDate)
  if (filters.toDate) query = query.lte('due_at', filters.toDate)

  const { data, count, error } = await query.range(from, to)
  if (error) throw new Error(error.message)

  const rows = await hydrateScheduledItems(db, (data ?? []) as Parameters<typeof hydrateScheduledItems>[1])
  return { rows, totalCount: count ?? 0 }
}

export async function createScheduledItem(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  input: {
    title: string
    itemType: ScheduledItemType
    dueAt: string
    isRecurring?: boolean
    priority?: string | null
    assignedToId?: string | null
    contactId?: string | null
    notes?: string | null
  },
): Promise<ScheduledItemRow> {
  const { data, error } = await db
    .from('workspace_scheduled_items')
    .insert({
      account_id: accountId,
      title: input.title,
      item_type: input.itemType,
      due_at: input.dueAt,
      is_recurring: input.isRecurring ?? false,
      priority: input.priority ?? null,
      assigned_to: input.assignedToId ?? null,
      contact_id: input.contactId ?? null,
      notes: input.notes ?? null,
      created_by: userId,
    })
    .select('id, title, item_type, due_at, is_recurring, priority, status, assigned_to, contact_id, notes, created_at')
    .single()
  if (error) throw new Error(error.message)
  const [row] = await hydrateScheduledItems(db, [data as Parameters<typeof hydrateScheduledItems>[1][number]])
  return row
}

export async function updateScheduledItem(
  db: SupabaseClient,
  accountId: string,
  id: string,
  patch: { status?: string; title?: string; dueAt?: string; priority?: string | null; assignedToId?: string | null },
): Promise<void> {
  const update: Record<string, unknown> = {}
  if (patch.status !== undefined) update.status = patch.status
  if (patch.title !== undefined) update.title = patch.title
  if (patch.dueAt !== undefined) update.due_at = patch.dueAt
  if (patch.priority !== undefined) update.priority = patch.priority
  if (patch.assignedToId !== undefined) update.assigned_to = patch.assignedToId

  const { error } = await db.from('workspace_scheduled_items').update(update).eq('id', id).eq('account_id', accountId)
  if (error) throw new Error(error.message)
}

export async function deleteScheduledItem(db: SupabaseClient, accountId: string, id: string): Promise<void> {
  const { error } = await db.from('workspace_scheduled_items').delete().eq('id', id).eq('account_id', accountId)
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------
// Campaign Planner — Phase 3. Planning only, per the spec's explicit
// "do not integrate with unsupported messaging execution" — nothing
// here ever calls the broadcast/send pipeline.
// ---------------------------------------------------------------

export interface ChecklistItem {
  text: string
  done: boolean
}

export interface CampaignPlanRow {
  id: string
  name: string
  ownerId: string | null
  ownerName: string | null
  audienceSegment: string | null
  contentDraft: string | null
  mediaUrl: string | null
  status: string
  planningDate: string | null
  checklist: ChecklistItem[]
  notes: string | null
  createdAt: string
}

export async function getCampaignPlans(
  db: SupabaseClient,
  accountId: string,
  filters: { status?: string; page?: number; pageSize?: number },
): Promise<{ rows: CampaignPlanRow[]; totalCount: number }> {
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
  const page = filters.page ?? 0
  const from = page * pageSize
  const to = from + pageSize - 1

  let query = db
    .from('workspace_campaign_plans')
    .select(
      'id, name, owner_id, audience_segment, content_draft, media_url, status, planning_date, checklist, notes, created_at, profiles(full_name)',
      { count: 'exact' },
    )
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })

  if (filters.status) query = query.eq('status', filters.status)

  const { data, count, error } = await query.range(from, to)
  if (error) throw new Error(error.message)

  const rows = ((data ?? []) as unknown as Array<{
    id: string
    name: string
    owner_id: string | null
    audience_segment: string | null
    content_draft: string | null
    media_url: string | null
    status: string
    planning_date: string | null
    checklist: ChecklistItem[] | null
    notes: string | null
    created_at: string
    profiles: { full_name: string | null }[] | { full_name: string | null } | null
  }>).map((p) => {
    const owner = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles
    return {
      id: p.id,
      name: p.name,
      ownerId: p.owner_id,
      ownerName: owner?.full_name ?? null,
      audienceSegment: p.audience_segment,
      contentDraft: p.content_draft,
      mediaUrl: p.media_url,
      status: p.status,
      planningDate: p.planning_date,
      checklist: p.checklist ?? [],
      notes: p.notes,
      createdAt: p.created_at,
    }
  })

  return { rows, totalCount: count ?? 0 }
}

export async function createCampaignPlan(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  input: { name: string; audienceSegment?: string | null; contentDraft?: string | null; planningDate?: string | null },
): Promise<{ id: string }> {
  const { data, error } = await db
    .from('workspace_campaign_plans')
    .insert({
      account_id: accountId,
      name: input.name,
      audience_segment: input.audienceSegment ?? null,
      content_draft: input.contentDraft ?? null,
      planning_date: input.planningDate ?? null,
      created_by: userId,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data as { id: string }
}

export async function updateCampaignPlan(
  db: SupabaseClient,
  accountId: string,
  id: string,
  patch: { status?: string; checklist?: ChecklistItem[]; contentDraft?: string | null; notes?: string | null },
): Promise<void> {
  const update: Record<string, unknown> = {}
  if (patch.status !== undefined) update.status = patch.status
  if (patch.checklist !== undefined) update.checklist = patch.checklist
  if (patch.contentDraft !== undefined) update.content_draft = patch.contentDraft
  if (patch.notes !== undefined) update.notes = patch.notes

  const { error } = await db.from('workspace_campaign_plans').update(update).eq('id', id).eq('account_id', accountId)
  if (error) throw new Error(error.message)
}

export async function deleteCampaignPlan(db: SupabaseClient, accountId: string, id: string): Promise<void> {
  const { error } = await db.from('workspace_campaign_plans').delete().eq('id', id).eq('account_id', accountId)
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------
// Analytics — Every metric is aggregated from tables the tenant
// already has. AI Usage reuses the existing ai_usage_log table
// (migration 033, widened by migration 052) — the same one that
// already tracked the tenant's auto-reply/draft AI spend; it just
// hadn't been queried from here yet.
// ---------------------------------------------------------------

export interface WorkspaceAnalytics {
  conversations: { open: number; pending: number; closed: number; archived: number }
  customers: { total: number; newThisWeek: number; newThisMonth: number; bySource: Array<{ source: string; count: number }> }
  leads: { open: number; won: number; lost: number; conversionRate: number }
  followups: { pending: number; completed: number }
  labelDistribution: Array<{ name: string; color: string; count: number }>
  customerGrowth: Array<{ weekStart: string; count: number }>
  retentionRate: number
  /** Only meaningful once the tenant has connected a QR personal
   *  WhatsApp number — all zero (not fabricated) if they haven't. */
  personalWhatsapp: {
    conversationCount: number
    messageCount: number
    messagesToday: number
    avgResponseTimeMinutes: number | null
  }
  aiUsage: { calls: number; totalTokens: number }
  notTrackedYet: string[]
}

export async function getWorkspaceAnalytics(db: SupabaseClient, accountId: string): Promise<WorkspaceAnalytics> {
  const weekAgo = daysAgoIso(7)
  const monthAgo = daysAgoIso(30)
  const eightWeeksAgo = daysAgoIso(56)
  const todayStart = startOfLocalDay()

  const [
    { data: convStatuses },
    { data: contactRows },
    { data: dealStatuses },
    { data: followupRows },
    { data: tags },
    { data: activeConvs },
    { count: personalConvCount },
    { count: personalMsgCount },
    { count: personalMsgToday },
    { data: personalRecentMsgs },
    { data: aiUsageRows },
  ] = await Promise.all([
    db.from('conversations').select('status').eq('account_id', accountId),
    db.from('contacts').select('id, source, created_at').eq('account_id', accountId),
    db.from('deals').select('status').eq('account_id', accountId),
    db.from('workspace_scheduled_items').select('status').eq('account_id', accountId).in('item_type', ['follow_up', 'reminder', 'task']),
    db.from('tags').select('id, name, color').eq('account_id', accountId),
    db.from('conversations').select('contact_id, last_message_at').eq('account_id', accountId).gte('last_message_at', monthAgo),
    db.from('workspace_whatsapp_personal_conversations').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
    db.from('workspace_whatsapp_personal_messages').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
    db
      .from('workspace_whatsapp_personal_messages')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .gte('created_at', todayStart),
    db
      .from('workspace_whatsapp_personal_messages')
      .select('conversation_id, direction, created_at')
      .eq('account_id', accountId)
      .gte('created_at', weekAgo)
      .order('created_at', { ascending: true })
      .limit(2000),
    db.from('ai_usage_log').select('total_tokens').eq('account_id', accountId).eq('mode', 'workspace_assistant').gte('created_at', monthAgo),
  ])

  const conversations = { open: 0, pending: 0, closed: 0, archived: 0 }
  for (const c of (convStatuses ?? []) as Array<{ status: string }>) {
    if (c.status in conversations) conversations[c.status as keyof typeof conversations]++
  }

  const contacts = (contactRows ?? []) as Array<{ id: string; source: string | null; created_at: string }>
  const bySourceMap = new Map<string, number>()
  let newThisWeek = 0
  let newThisMonth = 0
  const weekBuckets = new Map<string, number>()
  for (const c of contacts) {
    const source = c.source ?? 'unknown'
    bySourceMap.set(source, (bySourceMap.get(source) ?? 0) + 1)
    if (c.created_at >= weekAgo) newThisWeek++
    if (c.created_at >= monthAgo) newThisMonth++
    if (c.created_at >= eightWeeksAgo) {
      const weekStart = new Date(c.created_at)
      weekStart.setHours(0, 0, 0, 0)
      weekStart.setDate(weekStart.getDate() - weekStart.getDay())
      const key = weekStart.toISOString().slice(0, 10)
      weekBuckets.set(key, (weekBuckets.get(key) ?? 0) + 1)
    }
  }

  const deals = { open: 0, won: 0, lost: 0 }
  for (const d of (dealStatuses ?? []) as Array<{ status: string }>) {
    if (d.status in deals) deals[d.status as keyof typeof deals]++
  }
  const closedDeals = deals.won + deals.lost
  const conversionRate = closedDeals > 0 ? Math.round((deals.won / closedDeals) * 1000) / 10 : 0

  const followups = { pending: 0, completed: 0 }
  for (const f of (followupRows ?? []) as Array<{ status: string }>) {
    if (f.status === 'pending') followups.pending++
    if (f.status === 'completed') followups.completed++
  }

  const tagRows = (tags ?? []) as Array<{ id: string; name: string; color: string }>
  const tagIds = tagRows.map((t) => t.id)
  const { data: tagUsage } =
    tagIds.length > 0
      ? await db.from('contact_tags').select('tag_id').in('tag_id', tagIds)
      : { data: [] as Array<{ tag_id: string }> }
  const usageCount = new Map<string, number>()
  for (const u of (tagUsage ?? []) as Array<{ tag_id: string }>) {
    usageCount.set(u.tag_id, (usageCount.get(u.tag_id) ?? 0) + 1)
  }
  const labelDistribution = tagRows
    .map((t) => ({ name: t.name, color: t.color, count: usageCount.get(t.id) ?? 0 }))
    .sort((a, b) => b.count - a.count)

  const activeContactIds = new Set(
    ((activeConvs ?? []) as Array<{ contact_id: string; last_message_at: string | null }>).map((c) => c.contact_id),
  )
  const retentionRate = contacts.length > 0 ? Math.round((activeContactIds.size / contacts.length) * 1000) / 10 : 0

  const customerGrowth = [...weekBuckets.entries()]
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([weekStart, count]) => ({ weekStart, count }))

  // Same "gap between an inbound message and the next outbound reply"
  // approach as the Overview's Cloud API response time, applied to
  // the isolated personal-WhatsApp message table instead.
  const byPersonalConversation = new Map<string, Array<{ direction: string; created_at: string }>>()
  for (const m of (personalRecentMsgs ?? []) as Array<{ conversation_id: string; direction: string; created_at: string }>) {
    const list = byPersonalConversation.get(m.conversation_id) ?? []
    list.push({ direction: m.direction, created_at: m.created_at })
    byPersonalConversation.set(m.conversation_id, list)
  }
  const personalGaps: number[] = []
  for (const msgs of byPersonalConversation.values()) {
    for (let i = 0; i < msgs.length - 1; i++) {
      if (msgs[i].direction === 'inbound' && msgs[i + 1].direction === 'outbound') {
        const gap = (new Date(msgs[i + 1].created_at).getTime() - new Date(msgs[i].created_at).getTime()) / 60000
        if (gap >= 0) personalGaps.push(gap)
      }
    }
  }
  const personalAvgResponseTimeMinutes =
    personalGaps.length > 0 ? Math.round((personalGaps.reduce((a, b) => a + b, 0) / personalGaps.length) * 10) / 10 : null

  return {
    conversations,
    customers: {
      total: contacts.length,
      newThisWeek,
      newThisMonth,
      bySource: [...bySourceMap.entries()].map(([source, count]) => ({ source, count })),
    },
    leads: { open: deals.open, won: deals.won, lost: deals.lost, conversionRate },
    followups,
    labelDistribution,
    customerGrowth,
    retentionRate,
    personalWhatsapp: {
      conversationCount: personalConvCount ?? 0,
      messageCount: personalMsgCount ?? 0,
      messagesToday: personalMsgToday ?? 0,
      avgResponseTimeMinutes: personalAvgResponseTimeMinutes,
    },
    aiUsage: {
      calls: (aiUsageRows ?? []).length,
      totalTokens: ((aiUsageRows ?? []) as Array<{ total_tokens: number }>).reduce((sum, r) => sum + r.total_tokens, 0),
    },
    notTrackedYet: [],
  }
}

// ---------------------------------------------------------------
// Reports — Phase 3. One consolidated period report rather than six
// separate report engines — covers the spec's Customer/Lead/
// Performance/Activity/Follow-up categories for the chosen period in
// a single, honest view.
// ---------------------------------------------------------------

export type ReportPeriod = 'daily' | 'weekly' | 'monthly'

export interface WorkspaceReport {
  period: ReportPeriod
  rangeStart: string
  rangeEnd: string
  newCustomers: number
  newLeads: number
  dealsWon: number
  dealsLost: number
  conversationsClosed: number
  notesAdded: number
  topAgent: { name: string; conversationsClosed: number } | null
  aiCalls: number
  notTrackedYet: string[]
}

export async function getWorkspaceReport(db: SupabaseClient, accountId: string, period: ReportPeriod): Promise<WorkspaceReport> {
  const days = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30
  const rangeStart = daysAgoIso(days)
  const rangeEnd = new Date().toISOString()

  const [{ count: newCustomers }, { data: newDeals }, { data: closedConvs }, { count: notesAdded }, { count: aiCalls }] =
    await Promise.all([
      db.from('contacts').select('id', { count: 'exact', head: true }).eq('account_id', accountId).gte('created_at', rangeStart),
      db.from('deals').select('status').eq('account_id', accountId).gte('updated_at', rangeStart),
      db
        .from('conversations')
        .select('assigned_agent_id')
        .eq('account_id', accountId)
        .eq('status', 'closed')
        .gte('updated_at', rangeStart),
      db.from('contact_notes').select('id', { count: 'exact', head: true }).eq('account_id', accountId).gte('created_at', rangeStart),
      db
        .from('ai_usage_log')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('mode', 'workspace_assistant')
        .gte('created_at', rangeStart),
    ])

  const dealRows = (newDeals ?? []) as Array<{ status: string }>
  const dealsWon = dealRows.filter((d) => d.status === 'won').length
  const dealsLost = dealRows.filter((d) => d.status === 'lost').length

  const closedByAgent = new Map<string, number>()
  for (const c of (closedConvs ?? []) as Array<{ assigned_agent_id: string | null }>) {
    if (!c.assigned_agent_id) continue
    closedByAgent.set(c.assigned_agent_id, (closedByAgent.get(c.assigned_agent_id) ?? 0) + 1)
  }
  let topAgent: { name: string; conversationsClosed: number } | null = null
  if (closedByAgent.size > 0) {
    const [topUserId, topCount] = [...closedByAgent.entries()].sort((a, b) => b[1] - a[1])[0]
    const { data: profile } = await db.from('profiles').select('full_name').eq('user_id', topUserId).maybeSingle()
    topAgent = { name: (profile as { full_name: string } | null)?.full_name ?? 'Unknown', conversationsClosed: topCount }
  }

  return {
    period,
    rangeStart,
    rangeEnd,
    newCustomers: newCustomers ?? 0,
    newLeads: dealRows.length,
    dealsWon,
    dealsLost,
    conversationsClosed: [...closedByAgent.values()].reduce((a, b) => a + b, 0),
    notesAdded: notesAdded ?? 0,
    topAgent,
    aiCalls: aiCalls ?? 0,
    notTrackedYet: [],
  }
}

// ---------------------------------------------------------------
// Departments — simple named grouping of account members. No nested
// hierarchy, no per-department roles (RBAC stays flat at the account
// level); this is organizational grouping only, feeding Team
// Workspace's roster and Internal Chat's channel list.
// ---------------------------------------------------------------

export interface DepartmentRow {
  id: string
  name: string
  memberIds: string[]
  createdAt: string
}

export async function getDepartments(db: SupabaseClient, accountId: string): Promise<DepartmentRow[]> {
  const { data: departments, error } = await db
    .from('workspace_departments')
    .select('id, name, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  const deptRows = (departments ?? []) as Array<{ id: string; name: string; created_at: string }>
  if (deptRows.length === 0) return []

  const { data: members } = await db
    .from('workspace_department_members')
    .select('department_id, user_id')
    .in(
      'department_id',
      deptRows.map((d) => d.id),
    )
  const memberIdsByDept = new Map<string, string[]>()
  for (const m of (members ?? []) as Array<{ department_id: string; user_id: string }>) {
    const list = memberIdsByDept.get(m.department_id) ?? []
    list.push(m.user_id)
    memberIdsByDept.set(m.department_id, list)
  }

  return deptRows.map((d) => ({
    id: d.id,
    name: d.name,
    memberIds: memberIdsByDept.get(d.id) ?? [],
    createdAt: d.created_at,
  }))
}

export async function createDepartment(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  name: string,
): Promise<{ id: string }> {
  const { data, error } = await db
    .from('workspace_departments')
    .insert({ account_id: accountId, name, created_by: userId })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data as { id: string }
}

export async function deleteDepartment(db: SupabaseClient, accountId: string, departmentId: string): Promise<void> {
  const { error } = await db.from('workspace_departments').delete().eq('id', departmentId).eq('account_id', accountId)
  if (error) throw new Error(error.message)
}

export async function addDepartmentMember(db: SupabaseClient, departmentId: string, userId: string): Promise<void> {
  const { error } = await db
    .from('workspace_department_members')
    .upsert({ department_id: departmentId, user_id: userId }, { onConflict: 'department_id,user_id' })
  if (error) throw new Error(error.message)
}

export async function removeDepartmentMember(db: SupabaseClient, departmentId: string, userId: string): Promise<void> {
  const { error } = await db
    .from('workspace_department_members')
    .delete()
    .eq('department_id', departmentId)
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------
// Internal Chat — "General" (departmentId null) or a specific
// department's channel. Polling-based (matches Personal Inbox's
// pattern elsewhere in this module) rather than a Realtime
// subscription, to stay consistent with how every other live-ish
// view in this module already works.
// ---------------------------------------------------------------

export interface InternalMessageRow {
  id: string
  senderId: string
  senderName: string | null
  contentText: string
  createdAt: string
}

export async function getInternalMessages(
  db: SupabaseClient,
  accountId: string,
  departmentId: string | null,
  limit = 100,
): Promise<InternalMessageRow[]> {
  let query = db
    .from('workspace_internal_messages')
    .select('id, sender_id, content_text, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .limit(limit)
  query = departmentId ? query.eq('department_id', departmentId) : query.is('department_id', null)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as Array<{ id: string; sender_id: string; content_text: string; created_at: string }>
  if (rows.length === 0) return []

  const senderIds = [...new Set(rows.map((r) => r.sender_id))]
  const { data: profiles } = await db.from('profiles').select('user_id, full_name').in('user_id', senderIds)
  const nameByUserId = new Map((profiles ?? []).map((p) => [(p as { user_id: string }).user_id, (p as { full_name: string }).full_name]))

  return rows.map((r) => ({
    id: r.id,
    senderId: r.sender_id,
    senderName: nameByUserId.get(r.sender_id) ?? null,
    contentText: r.content_text,
    createdAt: r.created_at,
  }))
}

export async function postInternalMessage(
  db: SupabaseClient,
  accountId: string,
  departmentId: string | null,
  senderId: string,
  text: string,
): Promise<void> {
  const { error } = await db.from('workspace_internal_messages').insert({
    account_id: accountId,
    department_id: departmentId,
    sender_id: senderId,
    content_text: text,
  })
  if (error) throw new Error(error.message)
}
