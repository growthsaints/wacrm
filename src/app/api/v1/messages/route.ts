// ============================================================
// POST /api/v1/messages — send a WhatsApp message via the public API.
//
// The headline public endpoint (issue #245). Unlike the dashboard's
// `/api/whatsapp/send` (which takes an internal `conversation_id`),
// this takes a phone number — what an external automation actually
// has — resolves-or-creates the contact + conversation, then runs the
// same shared send core.
//
// Auth: API key with the `messages:send` scope. Account context (and
// the service-role client) come from `requireApiKey`.
//
// Body:
//   {
//     "to": "+14155550123",                 // required, E.164
//     "type": "text",                        // text|template|image|video|document|audio (default: text)
//     "text": "Hello!",                      // text body, or media caption
//     "media_url": "https://…/file.pdf",     // required for image/video/document/audio
//     "filename": "invoice.pdf",             // optional, document filename
//     "template": {                          // required when type=template
//       "name": "order_update",
//       "language": "en_US",
//       "params": ["A123"] | { "body": [...] }   // array = positional body; object = structured
//     },
//     "reply_to_message_id": "<uuid>",       // optional, must be in the same conversation
//     "name": "Jane Doe",                    // optional, names a newly-created contact
//     "idempotency_key": "order-42-shipped"  // optional, see below — an `Idempotency-Key`
//                                             //   header takes precedence over this field
//   }
//
// Idempotency: a retried request (same account, same key) within the
// stored window replays the *original* response verbatim — including
// status 201 — instead of sending the WhatsApp message a second time.
// Pass a caller-chosen key via the `Idempotency-Key` header (preferred,
// Stripe-style) or the `idempotency_key` body field. Omit it entirely
// for one-shot sends where replay safety doesn't matter (e.g. a human
// clicking "send" in a UI) — the key is optional, not required.
//
// Response (201):
//   { "data": { "message_id", "whatsapp_message_id", "conversation_id",
//               "contact_id", "contact_created" } }
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from '@/lib/whatsapp/send-message';
import {
  reserveIdempotencyKey,
  fillIdempotencyKey,
  releaseIdempotencyKey,
  extractIdempotencyKey,
} from '@/lib/api/v1/idempotency';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';

export async function POST(request: Request) {
  // Hoisted above the try so the catch block can release a reserved
  // idempotency key regardless of where in the pipeline it failed.
  let ctx: Awaited<ReturnType<typeof requireApiKey>> | null = null;
  let reservedIdempotencyKey: string | null = null;

  try {
    ctx = await requireApiKey(request, 'messages:send');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const to = typeof body.to === 'string' ? body.to.trim() : '';
    if (!to) {
      return fail('bad_request', "'to' is required", 400);
    }

    const idempotencyKey = extractIdempotencyKey(request, body);

    // Reserve the key BEFORE doing anything side-effecting. Two
    // concurrent requests for the same key both race on this INSERT;
    // the UNIQUE constraint lets exactly one through. The loser either
    // replays the winner's already-filled-in response, or — if the
    // winner hasn't finished yet — is told a send is already in
    // flight, rather than sending the message a second time.
    const reservation = await reserveIdempotencyKey(
      ctx.supabase,
      ctx.accountId,
      idempotencyKey
    );
    if (reservation.status === 'replay') {
      return ok(reservation.responseBody, 201);
    }
    if (reservation.status === 'in_progress') {
      return fail(
        'idempotency_in_progress',
        'A request with this idempotency key is already being processed',
        409
      );
    }
    if (reservation.status === 'reserved') {
      reservedIdempotencyKey = idempotencyKey;
    }

    const type = typeof body.type === 'string' ? body.type : 'text';

    // Unpack the optional `template` object into the flat params the
    // send core expects. `params` as an array → legacy positional body
    // params; as an object → structured header/body/button params.
    const template =
      body.template && typeof body.template === 'object'
        ? (body.template as Record<string, unknown>)
        : null;
    const templateParams = Array.isArray(template?.params)
      ? (template.params as unknown[]).filter(
          (p): p is string => typeof p === 'string'
        )
      : undefined;
    const templateMessageParams =
      template?.params && !Array.isArray(template.params)
        ? template.params
        : undefined;

    // Validate the message shape BEFORE resolveConversationByPhone
    // finds-or-creates a contact + conversation, so a bad payload 400s
    // without leaving an orphan contact/conversation behind.
    // Validated by `validateSendMessageParams` below; the cast just bridges
    // the untyped JSON body to the send-core param type.
    const interactivePayload =
      body.interactive_payload && typeof body.interactive_payload === 'object'
        ? (body.interactive_payload as InteractiveMessagePayload)
        : null;

    validateSendMessageParams({
      messageType: type,
      contentText: typeof body.text === 'string' ? body.text : null,
      mediaUrl: typeof body.media_url === 'string' ? body.media_url : null,
      templateName: typeof template?.name === 'string' ? template.name : null,
      interactivePayload,
    });

    // Find-or-create the conversation for this phone, then send. Both
    // steps share `SendMessageError`, so one catch maps the whole
    // pipeline to the envelope.
    const resolved = await resolveConversationByPhone(
      ctx.supabase,
      ctx.accountId,
      to,
      typeof body.name === 'string' ? body.name : null
    );

    const result = await sendMessageToConversation(
      ctx.supabase,
      ctx.accountId,
      {
        conversationId: resolved.conversationId,
        messageType: type,
        contentText: typeof body.text === 'string' ? body.text : null,
        mediaUrl: typeof body.media_url === 'string' ? body.media_url : null,
        filename: typeof body.filename === 'string' ? body.filename : null,
        templateName: typeof template?.name === 'string' ? template.name : null,
        templateLanguage:
          typeof template?.language === 'string' ? template.language : null,
        templateParams,
        templateMessageParams,
        interactivePayload,
        replyToMessageId:
          typeof body.reply_to_message_id === 'string'
            ? body.reply_to_message_id
            : null,
      }
    );

    const responseData = {
      message_id: result.messageId,
      whatsapp_message_id: result.whatsappMessageId,
      conversation_id: resolved.conversationId,
      contact_id: resolved.contactId,
      contact_created: resolved.contactCreated,
    };

    if (reservedIdempotencyKey) {
      await fillIdempotencyKey(
        ctx.supabase,
        ctx.accountId,
        reservedIdempotencyKey,
        responseData,
        result.messageId
      );
    }

    return ok(responseData, 201);
  } catch (err) {
    // The send never completed — release the reservation so a genuine
    // retry (not just a duplicate) isn't permanently stuck behind a
    // NULL response_body forever.
    if (reservedIdempotencyKey && ctx) {
      await releaseIdempotencyKey(ctx.supabase, ctx.accountId, reservedIdempotencyKey);
    }
    if (err instanceof SendMessageError) {
      return fail(err.code, err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
