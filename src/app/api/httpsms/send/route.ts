import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { sendHttpSmsToConversation, HttpSmsSendError } from '@/lib/httpsms/send-message'
import { resolveHttpSmsConversation, HttpSmsConversationError } from '@/lib/httpsms/conversation'

// The dashboard's httpSMS send endpoint — Contact Detail ("Send
// httpSMS") and Inbox replies on an httpsms-channel conversation both
// call this. Deliberately its own route rather than a branch inside
// /api/whatsapp/send: this whole channel is meant to be fully
// independent of the WhatsApp/SMS-Gateway send paths, not another
// conditional bolted onto an already-branching route.
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

    // Same budget/reasoning as the WhatsApp/SMS interactive send route
    // (RATE_LIMITS.send — "a human clicking send"), own bucket key so
    // it doesn't share budget with those channels.
    const limit = checkRateLimit(`httpsms-send:${user.id}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
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
    const { conversation_id: conversationIdInput, contact_id, message_type, content_text } = body

    if ((!conversationIdInput && !contact_id) || !message_type) {
      return NextResponse.json(
        { error: 'Either conversation_id or contact_id, plus message_type, are required' },
        { status: 400 },
      )
    }

    let conversationId: string
    if (conversationIdInput) {
      const { data, error: convError } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversationIdInput)
        .eq('account_id', accountId)
        .eq('channel', 'httpsms')
        .single()
      if (convError || !data) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
      }
      conversationId = data.id
    } else {
      const { data: contactRow, error: contactErr } = await supabase
        .from('contacts')
        .select('id')
        .eq('id', contact_id)
        .eq('account_id', accountId)
        .maybeSingle()
      if (contactErr || !contactRow) {
        return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
      }

      try {
        conversationId = await resolveHttpSmsConversation(supabase, accountId, user.id, contact_id)
      } catch (err) {
        if (err instanceof HttpSmsConversationError) {
          return NextResponse.json({ error: err.message }, { status: err.status })
        }
        throw err
      }
    }

    try {
      const result = await sendHttpSmsToConversation(supabase, accountId, {
        conversationId,
        messageType: message_type,
        contentText: content_text,
      })
      return NextResponse.json({
        success: true,
        message_id: result.messageId,
        provider_message_id: result.providerMessageId,
      })
    } catch (err) {
      if (err instanceof HttpSmsSendError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  } catch (error) {
    console.error('Error in httpSMS send POST:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
