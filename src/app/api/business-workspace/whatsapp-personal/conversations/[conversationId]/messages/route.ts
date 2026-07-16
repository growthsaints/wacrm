import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { sendPersonalMessage } from '@/lib/whatsapp-personal/socket-manager'

/**
 * GET /api/business-workspace/whatsapp-personal/conversations/[conversationId]/messages
 * Lists messages oldest-first and marks the conversation read (resets unread_count) as a side effect.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'whatsapp_personal_connect')
    const { conversationId } = await params

    const { data: messages, error } = await supabase
      .from('workspace_whatsapp_personal_messages')
      .select('id, direction, content_text, created_at')
      .eq('conversation_id', conversationId)
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await supabase
      .from('workspace_whatsapp_personal_conversations')
      .update({ unread_count: 0 })
      .eq('id', conversationId)
      .eq('account_id', accountId)

    return NextResponse.json({ messages: messages ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST .../messages — send a reply through the connected personal
 * WhatsApp session. Body: { text }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const { supabase, accountId, role, userId } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'whatsapp_personal_connect')
    const { conversationId } = await params

    const body = (await request.json().catch(() => null)) as { text?: unknown } | null
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!text) return NextResponse.json({ error: 'Message text is required' }, { status: 400 })

    const { data: conversation, error: convErr } = await supabase
      .from('workspace_whatsapp_personal_conversations')
      .select('id, workspace_whatsapp_personal_contacts(phone_number)')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (convErr) return NextResponse.json({ error: convErr.message }, { status: 500 })
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

    const contactRel = (
      conversation as unknown as {
        workspace_whatsapp_personal_contacts: { phone_number: string }[] | { phone_number: string } | null
      }
    ).workspace_whatsapp_personal_contacts
    const contact = Array.isArray(contactRel) ? contactRel[0] : contactRel
    if (!contact?.phone_number) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

    try {
      await sendPersonalMessage(accountId, contact.phone_number, text, userId)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to send message' },
        { status: 409 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
