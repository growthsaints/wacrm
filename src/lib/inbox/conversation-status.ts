import type { ConversationStatus } from '@/types'

/**
 * Single source of truth for conversation status label + color —
 * shared by the thread header's status dropdown (message-thread.tsx)
 * and the contact sidebar's status badge (contact-sidebar.tsx) so the
 * two never drift when a status is added/renamed.
 */
export const CONVERSATION_STATUS_OPTIONS: {
  label: string
  value: ConversationStatus
  color: string
}[] = [
  { label: 'Open', value: 'open', color: 'text-primary' },
  { label: 'Pending', value: 'pending', color: 'text-amber-400' },
  { label: 'Closed', value: 'closed', color: 'text-muted-foreground' },
  { label: 'Archived', value: 'archived', color: 'text-muted-foreground/70' },
]

export function conversationStatusOption(status: ConversationStatus) {
  return CONVERSATION_STATUS_OPTIONS.find((o) => o.value === status)
}
