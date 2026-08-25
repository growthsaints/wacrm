import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveSmsConversation, SmsConversationError } from '@/lib/sms/conversation'
import { sendSmsToConversation, SmsSendError } from '@/lib/sms/send-message'

/**
 * POST /api/sms/broadcast-send — one recipient of a bulk SMS campaign
 * (use-sms-broadcast.ts calls this once per recipient, batched
 * client-side).
 *
 * Deliberately a SEPARATE route from /api/whatsapp/send rather than
 * reusing it: that route's `checkRateLimit('send:'+userId, RATE_LIMITS.send)`
 * is 60/min, sized for "a human clicking send in the inbox" (per its
 * own comment) — a 200-contact broadcast dispatching in ~20 seconds
 * blows through that in under 6 seconds and the rest come back
 * "Rate limit exceeded", which is exactly the bug this route exists to
 * fix. Bulk traffic isn't interactive traffic; it needs a different
 * gate. The real protection here is the same one every other send path
 * already has: the per-device 100/day cap enforced inside
 * sendSmsToConversation, plus the client's own batch pacing (10/batch,
 * 1s apart) — not an additional per-minute counter that would just
 * recreate the same collision at a different threshold.
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
    const { contact_id, content_text, is_retry } = body
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
      conversationId = await resolveSmsConversation(supabase, accountId, user.id, contact_id)
    } catch (err) {
      if (err instanceof SmsConversationError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }

    try {
      const result = await sendSmsToConversation(supabase, accountId, {
        conversationId,
        messageType: 'text',
        contentText: content_text,
        // A retry may re-pin the conversation to a different device if
        // its originally-assigned one is at today's cap — the failed
        // recipient never actually received a message from that device,
        // so there's no existing thread to make inconsistent.
        allowDeviceReassignOnCap: Boolean(is_retry),
      })
      return NextResponse.json({
        success: true,
        message_id: result.messageId,
        gateway_message_id: result.gatewayMessageId,
        sms_config_id: result.smsConfigId,
      })
    } catch (err) {
      if (err instanceof SmsSendError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  } catch (error) {
    console.error('Error in SMS broadcast-send POST:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
