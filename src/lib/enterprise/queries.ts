import type { SupabaseClient } from '@supabase/supabase-js'
import { computeHealthStatus, type WhatsAppHealthStatus } from '@/lib/whatsapp/embedded-signup'

function startOfLocalDay(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

interface BroadcastTotals {
  totalRecipients: number
  sentCount: number
  deliveredCount: number
  readCount: number
  repliedCount: number
  failedCount: number
}

async function sumBroadcastTotals(db: SupabaseClient, accountId: string): Promise<BroadcastTotals> {
  const { data } = await db
    .from('broadcasts')
    .select('total_recipients, sent_count, delivered_count, read_count, replied_count, failed_count')
    .eq('account_id', accountId)

  const rows = (data ?? []) as Array<{
    total_recipients: number | null
    sent_count: number | null
    delivered_count: number | null
    read_count: number | null
    replied_count: number | null
    failed_count: number | null
  }>

  return rows.reduce<BroadcastTotals>(
    (acc, b) => ({
      totalRecipients: acc.totalRecipients + (b.total_recipients ?? 0),
      sentCount: acc.sentCount + (b.sent_count ?? 0),
      deliveredCount: acc.deliveredCount + (b.delivered_count ?? 0),
      readCount: acc.readCount + (b.read_count ?? 0),
      repliedCount: acc.repliedCount + (b.replied_count ?? 0),
      failedCount: acc.failedCount + (b.failed_count ?? 0),
    }),
    { totalRecipients: 0, sentCount: 0, deliveredCount: 0, readCount: 0, repliedCount: 0, failedCount: 0 },
  )
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0
}

/**
 * A transparent, documented 0-100 score — NOT a Meta-provided value.
 * Quality rating (40 pts) + connection health (30 pts) + broadcast
 * delivery rate (30 pts, defaulted to a neutral 20 if no broadcasts
 * have been sent yet so a brand-new account isn't penalized for
 * having no campaign history).
 */
export function computeHealthScore(args: {
  qualityRating: string | null
  health: WhatsAppHealthStatus
  deliveryRate: number
  hasBroadcasts: boolean
}): number {
  const { qualityRating, health, deliveryRate, hasBroadcasts } = args

  const qualityPoints =
    qualityRating === 'GREEN' ? 40 : qualityRating === 'YELLOW' ? 25 : qualityRating === 'RED' ? 5 : 20

  const connectionPoints = health === 'healthy' ? 30 : health === 'action_needed' ? 15 : 0

  const deliveryPoints = hasBroadcasts ? Math.round((deliveryRate / 100) * 30) : 20

  return Math.max(0, Math.min(100, qualityPoints + connectionPoints + deliveryPoints))
}

export interface AccountOverview {
  whatsapp: {
    connected: boolean
    businessName: string | null
    displayName: string | null
    phoneNumber: string | null
    qualityRating: string | null
    messagingLimitTier: string | null
    phoneVerificationStatus: string | null
    health: WhatsAppHealthStatus
  }
  messagesToday: number
  broadcastPerformance: {
    totalRecipients: number
    deliveryRate: number
    readRate: number
    replyRate: number
    failureRate: number
  }
  healthScore: number
}

export async function getAccountOverview(
  db: SupabaseClient,
  accountId: string,
): Promise<AccountOverview> {
  const todayStart = startOfLocalDay().toISOString()

  const [{ data: config }, { count: messagesToday }, totals] = await Promise.all([
    db.from('whatsapp_config').select('*').eq('account_id', accountId).maybeSingle(),
    db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('sender_type', 'agent')
      .gte('created_at', todayStart),
    sumBroadcastTotals(db, accountId),
  ])

  const health = computeHealthStatus({
    hasConfig: !!config,
    registeredAt: config?.registered_at ?? null,
    qualityRating: config?.quality_rating ?? null,
    lastRegistrationError: config?.last_registration_error ?? null,
  })

  const deliveryRate = pct(totals.deliveredCount, totals.totalRecipients)
  const readRate = pct(totals.readCount, totals.totalRecipients)
  const replyRate = pct(totals.repliedCount, totals.totalRecipients)
  const failureRate = pct(totals.failedCount, totals.totalRecipients)

  const healthScore = computeHealthScore({
    qualityRating: config?.quality_rating ?? null,
    health,
    deliveryRate,
    hasBroadcasts: totals.totalRecipients > 0,
  })

  return {
    whatsapp: {
      connected: config?.status === 'connected',
      businessName: config?.business_name ?? null,
      displayName: config?.display_name ?? null,
      phoneNumber: config?.display_phone_number ?? null,
      qualityRating: config?.quality_rating ?? null,
      messagingLimitTier: config?.messaging_limit_tier ?? null,
      phoneVerificationStatus: config?.code_verification_status ?? null,
      health,
    },
    messagesToday: messagesToday ?? 0,
    broadcastPerformance: {
      totalRecipients: totals.totalRecipients,
      deliveryRate,
      readRate,
      replyRate,
      failureRate,
    },
    healthScore,
  }
}

export interface AccountHealthWarning {
  id: string
  severity: 'critical' | 'warning'
  message: string
  recommendation: string
}

export interface AccountHealthHistoryPoint {
  date: string
  score: number
}

export interface AccountHealth {
  score: number
  qualityRating: string | null
  failureRate: number
  replyRate: number
  warnings: AccountHealthWarning[]
  /** Daily snapshots from enterprise_account_health_history — empty
   *  until the cron (/api/enterprise/account-health/cron) has run at
   *  least once for this account. No backfill exists for days before
   *  that; the page says so rather than showing a fabricated flat
   *  line. */
  history: AccountHealthHistoryPoint[]
}

export async function getAccountHealthHistory(
  db: SupabaseClient,
  accountId: string,
  days = 30,
): Promise<AccountHealthHistoryPoint[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data } = await db
    .from('enterprise_account_health_history')
    .select('snapshot_date, score')
    .eq('account_id', accountId)
    .gte('snapshot_date', since.toISOString().slice(0, 10))
    .order('snapshot_date', { ascending: true })

  return ((data ?? []) as Array<{ snapshot_date: string; score: number }>).map((r) => ({
    date: r.snapshot_date,
    score: r.score,
  }))
}

export async function getAccountHealth(
  db: SupabaseClient,
  accountId: string,
): Promise<AccountHealth> {
  const { data: config } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()
  const totals = await sumBroadcastTotals(db, accountId)

  const health = computeHealthStatus({
    hasConfig: !!config,
    registeredAt: config?.registered_at ?? null,
    qualityRating: config?.quality_rating ?? null,
    lastRegistrationError: config?.last_registration_error ?? null,
  })

  const failureRate = pct(totals.failedCount, totals.totalRecipients)
  const replyRate = pct(totals.repliedCount, totals.totalRecipients)
  const deliveryRate = pct(totals.deliveredCount, totals.totalRecipients)

  const score = computeHealthScore({
    qualityRating: config?.quality_rating ?? null,
    health,
    deliveryRate,
    hasBroadcasts: totals.totalRecipients > 0,
  })

  const warnings: AccountHealthWarning[] = []

  if (!config || config.status !== 'connected') {
    warnings.push({
      id: 'not_connected',
      severity: 'critical',
      message: 'No WhatsApp number is connected.',
      recommendation: 'Connect a WhatsApp Business Account in Settings → WhatsApp.',
    })
  }
  if (config?.quality_rating === 'RED') {
    warnings.push({
      id: 'quality_red',
      severity: 'critical',
      message: 'Your quality rating is Red.',
      recommendation:
        'Pause broadcasts, review recent templates for spammy content, and only message contacts who opted in.',
    })
  } else if (config?.quality_rating === 'YELLOW') {
    warnings.push({
      id: 'quality_yellow',
      severity: 'warning',
      message: 'Your quality rating is Yellow.',
      recommendation: 'Slow down send volume and review templates that received the most complaints.',
    })
  }
  if (config && (!config.messaging_limit_tier || config.messaging_limit_tier === 'TIER_250')) {
    warnings.push({
      id: 'low_tier',
      severity: 'warning',
      message: "You're on the lowest messaging tier (250/day).",
      recommendation:
        'Verify your business in Meta Business Suite, or keep sending high-quality messages to grow your tier automatically.',
    })
  }
  if (config?.last_registration_error) {
    warnings.push({
      id: 'registration_error',
      severity: 'warning',
      message: `Last registration error: ${config.last_registration_error}`,
      recommendation: 'Reconnect your WhatsApp number in Settings → WhatsApp.',
    })
  }
  if (totals.totalRecipients >= 20 && failureRate > 10) {
    warnings.push({
      id: 'high_failure_rate',
      severity: 'warning',
      message: `Broadcast failure rate is ${failureRate}%.`,
      recommendation: 'Check for invalid phone numbers, expired opt-ins, or a recently paused template.',
    })
  }

  const history = await getAccountHealthHistory(db, accountId)

  return {
    score,
    qualityRating: config?.quality_rating ?? null,
    failureRate,
    replyRate,
    warnings,
    history,
  }
}

export interface DeliveryInsights {
  submitted: number
  accepted: number
  delivered: number
  read: number
  failed: number
  pending: number
  replies: number
  templateDelivered: number
  mediaDelivered: number
  uniqueRecipients: number
}

export async function getDeliveryInsights(
  db: SupabaseClient,
  accountId: string,
): Promise<DeliveryInsights> {
  const { data: broadcasts } = await db
    .from('broadcasts')
    .select('id, template_name, template_language, sent_count, delivered_count')
    .eq('account_id', accountId)

  const broadcastRows = (broadcasts ?? []) as Array<{
    id: string
    template_name: string
    template_language: string
    sent_count: number | null
    delivered_count: number | null
  }>

  const totals = await sumBroadcastTotals(db, accountId)
  const pending = Math.max(0, totals.totalRecipients - totals.sentCount - totals.failedCount)

  // Every broadcast sends an approved template, so "template delivered"
  // is just delivered_count itself — the distinct figure worth
  // computing is how much of that used a media header specifically.
  let mediaDelivered = 0
  if (broadcastRows.length > 0) {
    const { data: templates } = await db
      .from('message_templates')
      .select('name, language, header_type')
      .eq('account_id', accountId)
    const headerByKey = new Map(
      ((templates ?? []) as Array<{ name: string; language: string; header_type: string | null }>).map(
        (t) => [`${t.name}::${t.language}`, t.header_type],
      ),
    )
    mediaDelivered = broadcastRows.reduce((sum, b) => {
      const headerType = headerByKey.get(`${b.template_name}::${b.template_language}`)
      const isMedia = headerType && headerType !== 'text'
      return sum + (isMedia ? (b.delivered_count ?? 0) : 0)
    }, 0)
  }

  let uniqueRecipients = 0
  if (broadcastRows.length > 0) {
    const { data: recipients } = await db
      .from('broadcast_recipients')
      .select('contact_id')
      .in('broadcast_id', broadcastRows.map((b) => b.id))
    uniqueRecipients = new Set(((recipients ?? []) as Array<{ contact_id: string }>).map((r) => r.contact_id)).size
  }

  return {
    submitted: totals.totalRecipients,
    accepted: totals.sentCount,
    delivered: totals.deliveredCount,
    read: totals.readCount,
    failed: totals.failedCount,
    pending,
    replies: totals.repliedCount,
    templateDelivered: totals.deliveredCount,
    mediaDelivered,
    uniqueRecipients,
  }
}

// ============================================================
// Broadcast Queue
// ============================================================

export interface QueuedBroadcast {
  id: string
  name: string
  status: string
  totalRecipients: number
  sentCount: number
  deliveredCount: number
  failedCount: number
  createdAt: string
}

export interface BroadcastQueue {
  running: QueuedBroadcast[]
  queued: QueuedBroadcast[]
  completed: QueuedBroadcast[]
  failed: QueuedBroadcast[]
}

/**
 * Groups broadcasts by their real, already-tracked status. There is no
 * pause/resume/cancel capability in the underlying send engine today,
 * so this is a read-only queue view rather than one with those
 * controls — showing non-functional buttons would be worse than not
 * showing them.
 */
export async function getBroadcastQueue(db: SupabaseClient, accountId: string): Promise<BroadcastQueue> {
  const { data } = await db
    .from('broadcasts')
    .select('id, name, status, total_recipients, sent_count, delivered_count, failed_count, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(100)

  const rows = ((data ?? []) as Array<{
    id: string
    name: string
    status: string
    total_recipients: number | null
    sent_count: number | null
    delivered_count: number | null
    failed_count: number | null
    created_at: string
  }>).map((b) => ({
    id: b.id,
    name: b.name,
    status: b.status,
    totalRecipients: b.total_recipients ?? 0,
    sentCount: b.sent_count ?? 0,
    deliveredCount: b.delivered_count ?? 0,
    failedCount: b.failed_count ?? 0,
    createdAt: b.created_at,
  }))

  return {
    running: rows.filter((b) => b.status === 'sending'),
    queued: rows.filter((b) => b.status === 'draft' || b.status === 'scheduled'),
    completed: rows.filter((b) => b.status === 'sent'),
    failed: rows.filter((b) => b.status === 'failed'),
  }
}

// ============================================================
// Engagement Analytics
// ============================================================

export interface EngagementAnalytics {
  readRate: number
  replyRate: number
  bestSendingHour: number | null
  bestSendingDay: string | null
  topCampaign: { name: string; readRate: number } | null
  topTemplate: { name: string; readRate: number } | null
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export async function getEngagementAnalytics(
  db: SupabaseClient,
  accountId: string,
): Promise<EngagementAnalytics> {
  const { data: broadcasts } = await db
    .from('broadcasts')
    .select('id, name, template_name, total_recipients, read_count, replied_count, created_at')
    .eq('account_id', accountId)

  const rows = (broadcasts ?? []) as Array<{
    id: string
    name: string
    template_name: string
    total_recipients: number | null
    read_count: number | null
    replied_count: number | null
    created_at: string
  }>

  const totals = rows.reduce(
    (acc, b) => ({
      recipients: acc.recipients + (b.total_recipients ?? 0),
      read: acc.read + (b.read_count ?? 0),
      replied: acc.replied + (b.replied_count ?? 0),
    }),
    { recipients: 0, read: 0, replied: 0 },
  )

  const topCampaign = rows
    .map((b) => ({ name: b.name, readRate: pct(b.read_count ?? 0, b.total_recipients ?? 0) }))
    .sort((a, b) => b.readRate - a.readRate)[0] ?? null

  const templateAgg = new Map<string, { read: number; total: number }>()
  for (const b of rows) {
    const cur = templateAgg.get(b.template_name) ?? { read: 0, total: 0 }
    cur.read += b.read_count ?? 0
    cur.total += b.total_recipients ?? 0
    templateAgg.set(b.template_name, cur)
  }
  const topTemplate =
    [...templateAgg.entries()]
      .map(([name, v]) => ({ name, readRate: pct(v.read, v.total) }))
      .sort((a, b) => b.readRate - a.readRate)[0] ?? null

  // Best sending hour/day — read from when recipients actually replied,
  // across every broadcast this account has sent (needs at least a
  // handful of data points to mean anything).
  let bestSendingHour: number | null = null
  let bestSendingDay: string | null = null
  if (rows.length > 0) {
    const { data: recipients } = await db
      .from('broadcast_recipients')
      .select('replied_at')
      .in('broadcast_id', rows.map((b) => b.id))
      .not('replied_at', 'is', null)

    const repliedRows = (recipients ?? []) as Array<{ replied_at: string }>
    if (repliedRows.length >= 5) {
      const byHour = new Array(24).fill(0)
      const byDay = new Array(7).fill(0)
      for (const r of repliedRows) {
        const d = new Date(r.replied_at)
        byHour[d.getHours()]++
        byDay[d.getDay()]++
      }
      bestSendingHour = byHour.indexOf(Math.max(...byHour))
      bestSendingDay = DAY_NAMES[byDay.indexOf(Math.max(...byDay))]
    }
  }

  return {
    readRate: pct(totals.read, totals.recipients),
    replyRate: pct(totals.replied, totals.recipients),
    bestSendingHour,
    bestSendingDay,
    topCampaign,
    topTemplate,
  }
}

// ============================================================
// Contact Intelligence
// ============================================================

export interface ContactIntelligenceRow {
  id: string
  name: string | null
  phone: string
  source: string | null
  leadScore: number | null
  tags: string[]
  messageCount: number
  conversationCount: number
}

export async function getContactIntelligence(
  db: SupabaseClient,
  accountId: string,
  limit = 50,
): Promise<ContactIntelligenceRow[]> {
  const { data: contacts } = await db
    .from('contacts')
    .select('id, name, phone, source, lead_score')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(limit)

  const rows = (contacts ?? []) as Array<{
    id: string
    name: string | null
    phone: string
    source: string | null
    lead_score: number | null
  }>
  if (rows.length === 0) return []

  const contactIds = rows.map((c) => c.id)

  const [{ data: tagLinks }, { data: conversations }] = await Promise.all([
    db.from('contact_tags').select('contact_id, tags(name)').in('contact_id', contactIds),
    db.from('conversations').select('id, contact_id').in('contact_id', contactIds),
  ])

  const tagsByContact = new Map<string, string[]>()
  for (const link of (tagLinks ?? []) as Array<{ contact_id: string; tags: { name: string } | { name: string }[] | null }>) {
    const tagObj = Array.isArray(link.tags) ? link.tags[0] : link.tags
    if (!tagObj?.name) continue
    const list = tagsByContact.get(link.contact_id) ?? []
    list.push(tagObj.name)
    tagsByContact.set(link.contact_id, list)
  }

  const conversationRows = (conversations ?? []) as Array<{ id: string; contact_id: string }>
  const conversationsByContact = new Map<string, string[]>()
  for (const c of conversationRows) {
    const list = conversationsByContact.get(c.contact_id) ?? []
    list.push(c.id)
    conversationsByContact.set(c.contact_id, list)
  }

  const allConversationIds = conversationRows.map((c) => c.id)
  const messageCountByConversation = new Map<string, number>()
  if (allConversationIds.length > 0) {
    const { data: messages } = await db
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', allConversationIds)
    for (const m of (messages ?? []) as Array<{ conversation_id: string }>) {
      messageCountByConversation.set(
        m.conversation_id,
        (messageCountByConversation.get(m.conversation_id) ?? 0) + 1,
      )
    }
  }

  return rows.map((c) => {
    const convIds = conversationsByContact.get(c.id) ?? []
    const messageCount = convIds.reduce((sum, id) => sum + (messageCountByConversation.get(id) ?? 0), 0)
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      source: c.source,
      leadScore: c.lead_score,
      tags: tagsByContact.get(c.id) ?? [],
      messageCount,
      conversationCount: convIds.length,
    }
  })
}

// ============================================================
// Template Intelligence
// ============================================================

export interface TemplateIntelligenceRow {
  name: string
  language: string
  category: string
  status: string
  headerType: string | null
  timesSent: number
  deliveryRate: number
  readRate: number
  replyRate: number
}

export async function getTemplateIntelligence(
  db: SupabaseClient,
  accountId: string,
): Promise<TemplateIntelligenceRow[]> {
  const [{ data: templates }, { data: broadcasts }] = await Promise.all([
    db
      .from('message_templates')
      .select('name, language, category, status, header_type')
      .eq('account_id', accountId),
    db
      .from('broadcasts')
      .select('template_name, template_language, total_recipients, delivered_count, read_count, replied_count')
      .eq('account_id', accountId),
  ])

  const templateRows = (templates ?? []) as Array<{
    name: string
    language: string
    category: string
    status: string
    header_type: string | null
  }>
  const broadcastRows = (broadcasts ?? []) as Array<{
    template_name: string
    template_language: string
    total_recipients: number | null
    delivered_count: number | null
    read_count: number | null
    replied_count: number | null
  }>

  const perfByKey = new Map<string, { recipients: number; delivered: number; read: number; replied: number }>()
  for (const b of broadcastRows) {
    const key = `${b.template_name}::${b.template_language}`
    const cur = perfByKey.get(key) ?? { recipients: 0, delivered: 0, read: 0, replied: 0 }
    cur.recipients += b.total_recipients ?? 0
    cur.delivered += b.delivered_count ?? 0
    cur.read += b.read_count ?? 0
    cur.replied += b.replied_count ?? 0
    perfByKey.set(key, cur)
  }

  return templateRows.map((t) => {
    const perf = perfByKey.get(`${t.name}::${t.language}`) ?? { recipients: 0, delivered: 0, read: 0, replied: 0 }
    return {
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      headerType: t.header_type,
      timesSent: perf.recipients,
      deliveryRate: pct(perf.delivered, perf.recipients),
      readRate: pct(perf.read, perf.recipients),
      replyRate: pct(perf.replied, perf.recipients),
    }
  })
}

// ============================================================
// Warm-up Center — same underlying signals as Overview, framed for
// "how do I grow this number's trust with Meta" guidance. Phone/number
// age isn't something Meta exposes to us, so this uses "connected
// since" (when this number joined Growth Saints) as an honest proxy —
// never described as the number's true age.
// ============================================================

export interface WarmupCenter {
  qualityRating: string | null
  messagingLimitTier: string | null
  displayName: string | null
  connectedSince: string | null
  recommendations: string[]
}

export async function getWarmupCenter(db: SupabaseClient, accountId: string): Promise<WarmupCenter> {
  const { data: config } = await db
    .from('whatsapp_config')
    .select('quality_rating, messaging_limit_tier, display_name, connected_at')
    .eq('account_id', accountId)
    .maybeSingle()

  const recommendations: string[] = []
  if (!config?.messaging_limit_tier || config.messaging_limit_tier === 'TIER_250') {
    recommendations.push(
      'Send consistent, high-quality messages to unique customers to grow past the 250/day starting tier.',
    )
  }
  if (config?.quality_rating === 'YELLOW' || config?.quality_rating === 'RED') {
    recommendations.push('Slow down send volume until your quality rating recovers to Green.')
  }
  recommendations.push('Only message contacts who opted in — this is the single biggest driver of quality rating.')
  recommendations.push('Verify your business in Meta Business Suite to unlock higher tiers faster.')

  return {
    qualityRating: config?.quality_rating ?? null,
    messagingLimitTier: config?.messaging_limit_tier ?? null,
    displayName: config?.display_name ?? null,
    connectedSince: config?.connected_at ?? null,
    recommendations,
  }
}

// ============================================================
// Risk Center
// ============================================================

export interface RiskCenter {
  qualityRisk: 'low' | 'medium' | 'high'
  campaignRisk: 'low' | 'medium' | 'high'
  inactiveContacts: number
  failedContacts: number
  rejectedTemplates: number
  warnings: string[]
}

export async function getRiskCenter(db: SupabaseClient, accountId: string): Promise<RiskCenter> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: config }, totals, { count: inactiveContacts }, { count: rejectedTemplates }] = await Promise.all([
    db.from('whatsapp_config').select('quality_rating').eq('account_id', accountId).maybeSingle(),
    sumBroadcastTotals(db, accountId),
    db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .lt('updated_at', ninetyDaysAgo),
    db
      .from('message_templates')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('status', 'Rejected'),
  ])

  const failureRate = pct(totals.failedCount, totals.totalRecipients)
  const qualityRisk = config?.quality_rating === 'RED' ? 'high' : config?.quality_rating === 'YELLOW' ? 'medium' : 'low'
  const campaignRisk = failureRate > 15 ? 'high' : failureRate > 5 ? 'medium' : 'low'

  const warnings: string[] = []
  if (qualityRisk !== 'low') warnings.push(`Quality rating risk is ${qualityRisk}.`)
  if (campaignRisk !== 'low') warnings.push(`Broadcast failure rate is ${failureRate}% (${campaignRisk} risk).`)
  if ((inactiveContacts ?? 0) > 0) {
    warnings.push(`${inactiveContacts} contact(s) haven't been updated in 90+ days.`)
  }
  if ((rejectedTemplates ?? 0) > 0) {
    warnings.push(`${rejectedTemplates} template(s) were rejected by Meta.`)
  }

  return {
    qualityRisk,
    campaignRisk,
    inactiveContacts: inactiveContacts ?? 0,
    failedContacts: totals.failedCount,
    rejectedTemplates: rejectedTemplates ?? 0,
    warnings,
  }
}

// ============================================================
// Compliance Center
// ============================================================

export interface ComplianceEvent {
  id: string
  source: 'broadcast_failure' | 'account_event'
  message: string
  flagged: boolean
  createdAt: string
}

export interface ComplianceCenter {
  displayName: string | null
  phoneStatus: string
  messagingLimitTier: string | null
  qualityRating: string | null
  phoneVerificationStatus: string | null
  errorsTracked: true
  totalFailedMessages: number
  unresolvedFlaggedEvents: number
  recentErrors: ComplianceEvent[]
}

const ACCOUNT_EVENT_FIELD_LABELS: Record<string, string> = {
  account_review_update: 'Account review update',
  account_alerts: 'Account alert',
  phone_number_quality_update: 'Phone number quality changed',
  business_capability_update: 'Business capability changed',
  messaging_limit_tier: 'Messaging tier changed',
}

/**
 * Recent Errors now come from two real, already-populated sources —
 * no new error-log table needed:
 *   - broadcast_recipients.error_message (set whenever a broadcast
 *     send actually fails — this data has existed since the original
 *     broadcast schema).
 *   - whatsapp_account_events (migration 042) — every account-level
 *     webhook field Meta sends that isn't otherwise acted on (quality/
 *     capability/tier changes, review updates, alerts), already
 *     written by the webhook handler with a keyword-heuristic
 *     `flagged` column.
 * Earlier this page said "not tracked yet" because neither source had
 * been wired in — the data was there the whole time.
 */
export async function getComplianceCenter(db: SupabaseClient, accountId: string): Promise<ComplianceCenter> {
  const [{ data: config }, { data: failedRecipients }, { data: accountEvents }, totals] = await Promise.all([
    db
      .from('whatsapp_config')
      .select('display_name, status, messaging_limit_tier, quality_rating, code_verification_status')
      .eq('account_id', accountId)
      .maybeSingle(),
    db
      .from('broadcast_recipients')
      .select('id, error_message, created_at, broadcasts!inner(account_id)')
      .eq('broadcasts.account_id', accountId)
      .eq('status', 'failed')
      .not('error_message', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('whatsapp_account_events')
      .select('id, field, raw_value, flagged, resolved, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(10),
    sumBroadcastTotals(db, accountId),
  ])

  const failureEvents: ComplianceEvent[] = ((failedRecipients ?? []) as unknown as Array<{
    id: string
    error_message: string | null
    created_at: string
  }>).map((r) => ({
    id: `broadcast-${r.id}`,
    source: 'broadcast_failure' as const,
    message: r.error_message ?? 'Message failed to send',
    flagged: false,
    createdAt: r.created_at,
  }))

  const accountEventRows = (accountEvents ?? []) as Array<{
    id: string
    field: string
    raw_value: unknown
    flagged: boolean
    resolved: boolean
    created_at: string
  }>
  const accountEventItems: ComplianceEvent[] = accountEventRows.map((e) => {
    const label = ACCOUNT_EVENT_FIELD_LABELS[e.field] ?? e.field.replace(/_/g, ' ')
    const snippet = JSON.stringify(e.raw_value).slice(0, 140)
    return {
      id: `event-${e.id}`,
      source: 'account_event' as const,
      message: `${label}: ${snippet}`,
      flagged: e.flagged && !e.resolved,
      createdAt: e.created_at,
    }
  })

  const recentErrors = [...failureEvents, ...accountEventItems]
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
    .slice(0, 15)

  const unresolvedFlaggedEvents = accountEventRows.filter((e) => e.flagged && !e.resolved).length

  return {
    displayName: config?.display_name ?? null,
    phoneStatus: config?.status ?? 'disconnected',
    messagingLimitTier: config?.messaging_limit_tier ?? null,
    qualityRating: config?.quality_rating ?? null,
    phoneVerificationStatus: config?.code_verification_status ?? null,
    errorsTracked: true,
    totalFailedMessages: totals.failedCount,
    unresolvedFlaggedEvents,
    recentErrors,
  }
}

// ============================================================
// Campaign Analyzer — "before you send" static + historical analysis
// of one template. No live prediction model exists, so "estimated"
// figures are this account's own historical average for that template
// (or the account-wide average if the template has never been sent) —
// always labeled as an estimate from past performance, never a
// guarantee.
// ============================================================

export interface CampaignAnalysis {
  templateName: string
  language: string
  category: string
  bodyLength: number
  variableCount: number
  hasMediaHeader: boolean
  estimatedDeliveryRate: number
  estimatedReadRate: number
  estimatedReplyRate: number
  riskLevel: 'low' | 'medium' | 'high'
  suggestions: string[]
}

export async function analyzeCampaign(
  db: SupabaseClient,
  accountId: string,
  templateName: string,
  templateLanguage: string,
): Promise<CampaignAnalysis | null> {
  const { data: template } = await db
    .from('message_templates')
    .select('name, language, category, body_text, header_type')
    .eq('account_id', accountId)
    .eq('name', templateName)
    .eq('language', templateLanguage)
    .maybeSingle()
  if (!template) return null

  const variableCount = (template.body_text.match(/\{\{\d+\}\}/g) ?? []).length
  const bodyLength = template.body_text.length

  const { data: pastBroadcasts } = await db
    .from('broadcasts')
    .select('total_recipients, delivered_count, read_count, replied_count')
    .eq('account_id', accountId)
    .eq('template_name', templateName)
    .eq('template_language', templateLanguage)

  const pastRows = (pastBroadcasts ?? []) as Array<{
    total_recipients: number | null
    delivered_count: number | null
    read_count: number | null
    replied_count: number | null
  }>
  const hasHistory = pastRows.length > 0

  let source = pastRows
  if (!hasHistory) {
    const { data: accountBroadcasts } = await db
      .from('broadcasts')
      .select('total_recipients, delivered_count, read_count, replied_count')
      .eq('account_id', accountId)
    source = (accountBroadcasts ?? []) as typeof pastRows
  }

  const totals = source.reduce(
    (acc, b) => ({
      recipients: acc.recipients + (b.total_recipients ?? 0),
      delivered: acc.delivered + (b.delivered_count ?? 0),
      read: acc.read + (b.read_count ?? 0),
      replied: acc.replied + (b.replied_count ?? 0),
    }),
    { recipients: 0, delivered: 0, read: 0, replied: 0 },
  )

  const estimatedDeliveryRate = pct(totals.delivered, totals.recipients)
  const estimatedReadRate = pct(totals.read, totals.recipients)
  const estimatedReplyRate = pct(totals.replied, totals.recipients)

  const suggestions: string[] = []
  if (bodyLength > 500) suggestions.push('This message is long — shorter templates tend to get read faster.')
  if (variableCount > 4) suggestions.push('Many variables increase the chance of a bad merge — double-check sample data.')
  if (template.category === 'Marketing' && !hasHistory) {
    suggestions.push('First send of a Marketing template — start with a smaller audience to gauge quality impact.')
  }
  if (estimatedDeliveryRate > 0 && estimatedDeliveryRate < 80) {
    suggestions.push('Historical delivery rate is below 80% — check your audience for stale/invalid numbers.')
  }
  if (suggestions.length === 0) suggestions.push('No specific concerns — this template looks reasonable to send.')

  const riskLevel: CampaignAnalysis['riskLevel'] =
    template.category === 'Marketing' && (variableCount > 4 || bodyLength > 500)
      ? 'high'
      : template.category === 'Marketing'
        ? 'medium'
        : 'low'

  return {
    templateName: template.name,
    language: template.language,
    category: template.category,
    bodyLength,
    variableCount,
    hasMediaHeader: Boolean(template.header_type && template.header_type !== 'text'),
    estimatedDeliveryRate,
    estimatedReadRate,
    estimatedReplyRate,
    riskLevel,
    suggestions,
  }
}
