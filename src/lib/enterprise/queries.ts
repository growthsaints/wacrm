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

export interface AccountHealth {
  score: number
  qualityRating: string | null
  failureRate: number
  replyRate: number
  warnings: AccountHealthWarning[]
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

  return {
    score,
    qualityRating: config?.quality_rating ?? null,
    failureRate,
    replyRate,
    warnings,
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
