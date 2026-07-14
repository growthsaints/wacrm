import type { Contact } from '@/types'

/** Human-readable label for `contacts.source` (migration 039). Shared
 *  by the Inbox contact sidebar, the Contacts Activity tab, and the
 *  timeline builder so "Lead Source" reads identically everywhere. */
export function contactSourceLabel(source: Contact['source'] | null | undefined): string {
  switch (source) {
    case 'manual':
      return 'Manual entry'
    case 'import':
      return 'CSV import'
    case 'api':
      return 'API'
    case 'whatsapp_inbound':
      return 'Inbound WhatsApp message'
    default:
      return 'Unknown'
  }
}
