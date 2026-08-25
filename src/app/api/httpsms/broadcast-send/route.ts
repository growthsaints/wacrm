import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveHttpSmsConversation, HttpSmsConversationError } from '@/lib/httpsms/conversation'
import { sendHttpSmsToConversation, HttpSmsSendError } from '@/lib/httpsms/send-message'

/**
 * POST /api/httpsms/broadcast-send — one recipient of a bulk httpSMS
 * campaign (use-httpsms-broadcast.ts calls this once per recipient,
 * batched client-side). A separate route from /api/httpsms/send for
 * the same reason /api/sms/broadcast-send is separate from
 * /api/whatsapp/send: that route's per-user interactive rate limit
 * (RATE_LIMITS.send, "a human clicking send") is far too tight for a
 * multi-recipient campaign dispatching in a burst. No per-device daily
 * cap to enforce here either way — httpSMS paces sends per phone on
 * its own side (Settings → Control SMS Send Rate on httpsms.com).
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const body = await request.json()
    const { contact_id, content_text, preferred_config_id } = body
    if (!contact_id || typeof content_text !== 'string' || !content_text.trim()) {
      return NextResponse.json({ error: 'contact_id and content_text are required' }, { status: 400 })
    }

    const { data: contactRow, error: contactErr } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contact_id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (contactErr || !contactRow) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    let conversationId: string
    try {
      conversationId = await resolveHttpSmsConversation(
        supabase,
        accountId,
        user.id,
        contact_id,
        typeof preferred_config_id === 'string' ? preferred_config_id : undefined,
      )
    } catch (err) {
      if (err instanceof HttpSmsConversationError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }

    try {
      const result = await sendHttpSmsToConversation(supabase, accountId, {
        conversationId,
        messageType: 'text',
        contentText: content_text,
      })
      return NextResponse.json({
        success: true,
        message_id: result.messageId,
        provider_message_id: result.providerMessageId,
        httpsms_config_id: result.httpsmsConfigId,
      })
    } catch (err) {
      if (err instanceof HttpSmsSendError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  } catch (error) {
    console.error('Error in httpSMS broadcast-send POST:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
