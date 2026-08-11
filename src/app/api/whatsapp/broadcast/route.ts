import { NextResponse } from 'next/server'
import { requireFeature, toErrorResponse } from '@/lib/auth/account'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder'
import { renderTemplateBodyText } from '@/lib/whatsapp/template-send-builder'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { categoryFromTemplate } from '@/lib/billing/rates'
import { ensureWalletBalance, chargeWalletForSend, WalletError } from '@/lib/billing/wallet'
import { ensureDailyBroadcastQuota, DailyQuotaError } from '@/lib/whatsapp/daily-quota'

interface BroadcastResult {
  phone: string
  status: 'sent' | 'failed'
  whatsapp_message_id?: string
  error?: string
}

/**
 * Two input shapes are accepted:
 *
 *   NEW (preferred — supports per-recipient variable substitution):
 *     {
 *       recipients: Array<{ phone: string; params: string[] }>,
 *       template_name, template_language
 *     }
 *
 *   LEGACY (all phones receive the same params — kept so existing
 *   callers don't break):
 *     {
 *       phone_numbers: string[],
 *       template_params: string[],
 *       template_name, template_language
 *     }
 *
 * Previous implementation only supported the legacy shape, and the
 * sending hook was forced to ship every batch with `templateParams[0]`
 * — meaning every recipient got contact-0's personalization. The new
 * shape is what actually fixes that.
 */
interface NewRecipient {
  phone: string
  /** Contact row id — when present, the sent template is also saved
   *  into that contact's conversation thread (see the messages insert
   *  below). Absent for the legacy `phone_numbers` shape, which has no
   *  contact context to attach a thread message to. */
  contactId?: string
  /** Body variable values, one per {{N}}. Legacy field. */
  params?: string[]
  /**
   * Structured per-send values (header text variable, media URL
   * override, URL/COPY_CODE button values). When set, takes
   * precedence over `params` for the body too — see
   * sendTemplateMessage for the merge rules.
   */
  messageParams?: SendTimeParams
}

/**
 * Same lookup-oldest-first-then-create pattern as the inbound
 * webhook's findOrCreateConversation (see
 * src/app/api/whatsapp/webhook/route.ts) — kept as a separate copy
 * rather than a shared import because that one is written against the
 * service-role client, while broadcasts run under the caller's
 * RLS-scoped session client.
 */
async function findOrCreateConversationForBroadcast(
  db: Awaited<ReturnType<typeof requireFeature>>['supabase'],
  accountId: string,
  userId: string,
  contactId: string,
): Promise<string | null> {
  const { data: existingRows, error: findError } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (findError) {
    console.error('[broadcast] error finding conversation:', findError)
    return null
  }
  if (existingRows && existingRows.length > 0) {
    return existingRows[0].id as string
  }

  const { data: newConv, error: createError } = await db
    .from('conversations')
    .insert({ account_id: accountId, user_id: userId, contact_id: contactId })
    .select('id')
    .single()

  if (createError) {
    // Lost a race with a concurrent insert (e.g. two batches of the
    // same broadcast hitting the same contact) — re-resolve the
    // winning row instead of dropping the message.
    const { data: raced } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1)
    if (raced && raced.length > 0) return raced[0].id as string
    console.error('[broadcast] error creating conversation:', createError)
    return null
  }

  return newConv.id as string
}

/**
 * Saves the sent template into the contact's conversation thread, same
 * shape as a manual template send (see send-message.ts) — best-effort:
 * the message already reached Meta, so a failure here is logged rather
 * than thrown.
 */
async function recordBroadcastMessage(
  db: Awaited<ReturnType<typeof requireFeature>>['supabase'],
  accountId: string,
  userId: string,
  contactId: string,
  templateName: string,
  whatsappMessageId: string,
  bodyText: string | null,
  headerMediaUrl: string | null,
): Promise<void> {
  const conversationId = await findOrCreateConversationForBroadcast(db, accountId, userId, contactId)
  if (!conversationId) return

  const { error: msgError } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'agent',
    content_type: 'template',
    content_text: bodyText,
    media_url: headerMediaUrl,
    template_name: templateName,
    message_id: whatsappMessageId,
    status: 'sent',
  })
  if (msgError) {
    console.error('[broadcast] error saving message to thread:', msgError)
    return
  }

  await db
    .from('conversations')
    .update({
      last_message_text: bodyText || `[${templateName}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
}

export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireFeature>>
  try {
    ctx = await requireFeature('broadcasts')
  } catch (err) {
    return toErrorResponse(err)
  }
  const { supabase, userId, accountId } = ctx

  try {
    // Per-user broadcast budget. Note: this limits how often a user
    // can *start* a campaign, not how many messages go out inside
    // one — the fan-out loop below runs without additional gating.
    const limit = checkRateLimit(`broadcast:${userId}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
    } = body

    // Normalize to a list of {phone, params} regardless of shape.
    let recipients: NewRecipient[]
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : []
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }))
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      )
    }

    if (!template_name) {
      return NextResponse.json(
        { error: 'template_name is required' },
        { status: 400 }
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Please set up your WhatsApp integration first.',
        },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    // Load the template row once so sendTemplateMessage can build
    // header + button components on each iteration. Loading inside
    // the loop would N+1 against Supabase for every recipient.
    // Guard against a malformed local row crashing every send in
    // the loop with the same opaque TypeError — fail loudly once.
    const { data: rawTemplateRow } = await supabase
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', template_name)
      .eq('language', template_language || 'en_US')
      .maybeSingle()
    if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
      return NextResponse.json(
        {
          error:
            'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
        },
        { status: 500 },
      )
    }
    const templateRow = rawTemplateRow ?? null
    const billingCategory = categoryFromTemplate(templateRow?.category)

    const results: BroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0

    for (const recipient of recipients) {
      const sanitized = sanitizePhoneForMeta(recipient.phone)

      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
        })
        failedCount++
        continue
      }

      // Checked per-recipient so a wallet that runs dry partway
      // through a broadcast stops billing further sends rather than
      // over-charging or aborting the whole batch.
      try {
        await ensureWalletBalance(supabase, accountId, billingCategory)
      } catch (err) {
        const message = err instanceof WalletError ? err.message : 'Wallet check failed'
        results.push({ phone: recipient.phone, status: 'failed', error: message })
        failedCount++
        continue
      }

      // Same per-recipient reasoning as the wallet check above — stops
      // sending the moment the account hits its Meta messaging-limit
      // tier's daily cap, rather than plowing through the rest of the
      // batch and risking Meta throttling/flagging the number.
      try {
        await ensureDailyBroadcastQuota(supabase, accountId)
      } catch (err) {
        const message = err instanceof DailyQuotaError ? err.message : 'Daily quota check failed'
        results.push({ phone: recipient.phone, status: 'failed', error: message })
        failedCount++
        continue
      }

      // Retry with phone variants on "not in allowed list" so numbers
      // that differ only in a trunk-prefix 0 still reach recipients.
      const variants = phoneVariants(sanitized)
      let sentMessageId: string | null = null
      let lastError: string | null = null

      for (const variant of variants) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: variant,
            templateName: template_name,
            language: template_language || 'en_US',
            template: templateRow ?? undefined,
            messageParams: recipient.messageParams,
            params: recipient.params ?? [],
          })
          sentMessageId = result.messageId
          lastError = null
          break
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error'
          if (!isRecipientNotAllowedError(errorMessage)) {
            lastError = errorMessage
            break
          }
          lastError = errorMessage
          // retry with next variant
        }
      }

      if (sentMessageId) {
        await chargeWalletForSend(supabase, accountId, billingCategory)
        if (recipient.contactId) {
          const bodyValues = recipient.messageParams?.body ?? recipient.params ?? []
          const bodyText = templateRow
            ? renderTemplateBodyText(templateRow.body_text, bodyValues)
            : null
          const isMediaHeaderTemplate =
            templateRow?.header_type === 'image' ||
            templateRow?.header_type === 'video' ||
            templateRow?.header_type === 'document'
          const headerMediaUrl = isMediaHeaderTemplate
            ? recipient.messageParams?.headerMediaUrl ?? templateRow?.header_media_url ?? null
            : null
          await recordBroadcastMessage(
            supabase,
            accountId,
            userId,
            recipient.contactId,
            template_name,
            sentMessageId,
            bodyText,
            headerMediaUrl,
          )
        }
        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: sentMessageId,
        })
        sentCount++
      } else {
        console.error(
          `Failed to send broadcast to ${recipient.phone}:`,
          lastError
        )
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: lastError || 'Unknown error',
        })
        failedCount++
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    })
  } catch (error) {
    console.error('Error in WhatsApp broadcast POST:', error)
    return NextResponse.json(
      { error: 'Failed to process broadcast' },
      { status: 500 }
    )
  }
}
