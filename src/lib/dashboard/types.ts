// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export interface MetricDelta {
  current: number
  previous: number
}

export interface MetricsBundle {
  activeConversations: MetricDelta
  newContactsToday: MetricDelta
  openDealsValue: number
  openDealsCount: number
  messagesSentToday: MetricDelta
}

export interface ConversationsSeriesPoint {
  day: string // YYYY-MM-DD local
  incoming: number
  outgoing: number
}

export interface PipelineStageSlice {
  id: string
  name: string
  color: string
  dealCount: number
  totalValue: number
}

export interface PipelineDonutData {
  stages: PipelineStageSlice[]
  totalValue: number
}

export interface ResponseTimeBucket {
  /** 0 = Mon … 6 = Sun (Monday-first). */
  dow: number
  /** Average first-response time in minutes. Null means no samples. */
  avgMinutes: number | null
  samples: number
}

export interface ResponseTimeSummary {
  buckets: ResponseTimeBucket[]
  thisWeekAvg: number | null
  lastWeekAvg: number | null
}

export type ActivityKind =
  | 'message'
  | 'deal'
  | 'broadcast'
  | 'automation'
  | 'contact'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  /** Primary line of text rendered in the feed. Pre-formatted. */
  text: string
  /** ISO timestamp the item happened at, drives relative-time + sort. */
  at: string
  /** Optional deep-link for the whole row (not all items have a target). */
  href?: string
}

export interface TopAgentStat {
  userId: string
  fullName: string
  assignedCount: number
  resolvedCount: number
  /** Null when the agent has no first-response samples in the window. */
  avgResponseMinutes: number | null
}

export interface TopCampaignStat {
  id: string
  name: string
  status: string
  totalRecipients: number
  sentCount: number
  deliveredCount: number
  readCount: number
  repliedCount: number
}

export interface ContactGrowthPoint {
  day: string // YYYY-MM-DD local
  count: number
}

/**
 * Combined automation + flow analytics (Milestone 4, Part 8) — merges
 * the legacy automations engine's `automation_logs` with the unified
 * flows engine's `flow_runs`/`flow_run_events` into one comparable
 * shape, since both are real production automation surfaces users
 * need visibility into side by side.
 */
export interface AutomationAnalyticsItem {
  id: string
  name: string
  engine: 'automation' | 'flow'
  executionCount: number
  successCount: number
  failureCount: number
  successRate: number // 0-100
  /** Null when no timed samples exist yet. */
  avgExecutionMinutes: number | null
}

export interface AutomationAnalyticsSummary {
  totalExecutions: number
  totalSuccesses: number
  totalFailures: number
  successRate: number // 0-100
  topPerforming: AutomationAnalyticsItem[]
}
