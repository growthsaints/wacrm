import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'

/** GET /api/business-workspace/whatsapp-personal/conversations — list, newest first. */
export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'whatsapp_personal_connect')

    const { data, error } = await supabase
      .from('workspace_whatsapp_personal_conversations')
      .select('id, last_message_text, last_message_at, unread_count, workspace_whatsapp_personal_contacts(phone_number, display_name)')
      .eq('account_id', accountId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const conversations = ((data ?? []) as unknown as Array<{
      id: string
      last_message_text: string | null
      last_message_at: string | null
      unread_count: number
      workspace_whatsapp_personal_contacts:
        | { phone_number: string; display_name: string | null }[]
        | { phone_number: string; display_name: string | null }
        | null
    }>).map((c) => {
      const contact = Array.isArray(c.workspace_whatsapp_personal_contacts)
        ? c.workspace_whatsapp_personal_contacts[0]
        : c.workspace_whatsapp_personal_contacts
      return {
        id: c.id,
        phoneNumber: contact?.phone_number ?? '',
        displayName: contact?.display_name ?? null,
        lastMessageText: c.last_message_text,
        lastMessageAt: c.last_message_at,
        unreadCount: c.unread_count,
      }
    })

    return NextResponse.json({ conversations })
  } catch (err) {
    return toErrorResponse(err)
  }
}
