// Shared shape for a single contact's activity timeline (Contacts →
// Activity tab, Inbox contact sidebar). Mirrors the dashboard's
// `ActivityItem` shape (src/lib/dashboard/types.ts) deliberately —
// same rendering contract, different source query — but kept as its
// own type since the event vocabulary is contact-scoped, not global.

export type TimelineEventKind =
  | 'lead_created'
  | 'conversation_started'
  | 'tag_added'
  | 'note'
  | 'broadcast'
  | 'agent_assigned'
  | 'deal'
  | 'status_change'

export interface TimelineEvent {
  id: string
  kind: TimelineEventKind
  /** Primary line of text rendered in the timeline. Pre-formatted. */
  text: string
  /** ISO timestamp the event happened at — drives sort + relative time. */
  at: string
  href?: string
}
