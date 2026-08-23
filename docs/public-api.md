# Public API (`/api/v1`)

The public API lets you drive your wacrm instance from your own
scripts and automations — send messages, manage contacts, launch
broadcasts — without going through the dashboard UI.

> **Status:** stable. Authentication, scopes, rate limiting, the
> messages / contacts / conversations / broadcasts endpoints, and
> outbound event [webhooks](#webhooks) all ship now.

## Authentication

Every request authenticates with an **API key**, sent as a bearer
token:

```
Authorization: Bearer wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Keys are **account-scoped**: a key acts on exactly one account, the
one it was created in. There is no cross-account access.

### Creating a key

In the dashboard: **Settings → API keys → New API key**. Only
**admins and owners** can create keys.

1. Give the key a name (after the integration that will use it).
2. Grant the **scopes** it needs — nothing more (see below).
3. Copy the key. **The full key is shown exactly once.** wacrm
   stores only a SHA-256 hash, so it can never be shown again. If you
   lose it, revoke it and create a new one.

### Revoking a key

**Settings → API keys → Revoke.** Revocation is effective on the
key's next request. Revoked keys stay in the list as an audit trail.

## Scopes

A key can do only what its scopes allow — independent of who created
it. Grant the minimum.

| Scope                | Allows                                   |
| -------------------- | ---------------------------------------- |
| `messages:send`      | Send WhatsApp messages                   |
| `messages:read`      | Read messages and delivery status        |
| `contacts:read`      | List and read contacts                   |
| `contacts:write`     | Create and update contacts               |
| `conversations:read` | List and read conversations              |
| `broadcasts:send`    | Launch broadcast campaigns               |
| `webhooks:manage`    | Register and manage outbound webhooks    |
| `flows:trigger`      | Start automation flows for a contact     |
| `notifications:manage` | Configure event → template notification rules |

A key with **no scopes** still authenticates and can call
`GET /api/v1/me` — useful for verifying a key works.

## Response envelope

Every response uses one of two shapes:

```jsonc
// success
{ "data": { /* ... */ } }

// failure
{ "error": { "code": "forbidden", "message": "This API key is missing the 'messages:send' scope" } }
```

Branch on `error.code` (stable); `error.message` is for humans and
may be reworded.

| Status | `code`         | Meaning                                          |
| ------ | -------------- | ------------------------------------------------ |
| 401    | `unauthorized` | Missing / malformed / unknown / revoked / expired key |
| 403    | `forbidden`    | Valid key, but missing the required scope        |
| 429    | `rate_limited` | Per-key rate limit exceeded                      |
| 400    | `bad_request`  | Malformed input                                  |
| 404    | `not_found`    | No such resource                                 |
| 500    | `internal`     | Server error                                     |

## Rate limits

Requests are limited **per key**: **120 requests per minute**. On a
`429`, these headers tell you when to retry:

- `Retry-After` — seconds until the window resets
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

> The limiter is in-memory and **per process**. A single-instance
> deploy (the common case for a self-hosted fork) is fine as-is. If
> you scale to multiple instances, swap the limiter for a shared
> store (Redis/Upstash) — see the note at the top of
> `src/lib/rate-limit.ts`. The limit is otherwise unenforced across
> instances.

## Endpoints

### `GET /api/v1/me`

Returns the account a key is bound to and the scopes it carries.
Requires only a valid key (no scope). Use it to verify a key works
and to discover its scopes.

```bash
curl https://your-crm.example.com/api/v1/me \
  -H "Authorization: Bearer wacrm_live_xxx"
```

```json
{
  "data": {
    "account": { "id": "…", "name": "Acme Inc" },
    "key": { "id": "…", "scopes": ["messages:send"] }
  }
}
```

### `POST /api/v1/messages`

Send a WhatsApp message to a phone number. Scope: `messages:send`. You
pass an **E.164 number**, not an internal id — the endpoint
finds-or-creates the contact + conversation, then sends.

```bash
curl -X POST https://your-crm.example.com/api/v1/messages \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "to": "+14155550123", "type": "text", "text": "Hi 👋" }'
```

`type` is `text` (default), `template`, or a media kind (`image` /
`video` / `document` / `audio`). Media needs `media_url` (and optional
`filename`); `text` doubles as the caption. `template` needs a
`template` object:

```jsonc
{
  "to": "+14155550123",
  "type": "template",
  "template": {
    "name": "order_update",
    "language": "en_US",
    "params": ["A123"]        // positional body vars, or a structured object
  },
  "reply_to_message_id": "<uuid>"   // optional; must be in the same conversation
}
```

Response (201):

```json
{
  "data": {
    "message_id": "…",
    "whatsapp_message_id": "wamid.…",
    "conversation_id": "…",
    "contact_id": "…",
    "contact_created": true
  }
}
```

Domain error codes beyond the table above: `whatsapp_not_configured`
(400), `meta_error` (502 — the request reached Meta and it rejected the
send), `template_malformed` (500).

**Idempotency.** A webhook-triggered caller (an order/payment/shipping
backend reacting to its own retried event) can't always tell whether a
prior send actually went through before it retries. Pass a caller-
chosen `Idempotency-Key` header (or an `idempotency_key` body field —
the header wins if both are set):

```bash
curl -X POST https://your-crm.example.com/api/v1/messages \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-42-shipped" \
  -d '{ "to": "+14155550123", "type": "template", "template": { "name": "order_shipped" } }'
```

Retrying the same request with the same key replays the *original*
`201` response instead of sending the message again. A retry that
races the original request while it's still in flight gets
`409 idempotency_in_progress` — retry again shortly. The key is
optional; omit it for one-shot sends (e.g. an agent clicking "send" in
the inbox) where replay safety doesn't matter.

### `GET /api/v1/contacts`

List contacts, newest first. Scope: `contacts:read`. Paginated (see
[Pagination](#pagination)). Optional filters: `?search=` (matches name
or phone) and `?tag=<tagId>`.

```json
{
  "data": [
    {
      "id": "…", "phone": "+14155550123", "name": "Jane Doe",
      "email": null, "company": "Acme", "avatar_url": null,
      "tags": [{ "id": "…", "name": "vip", "color": "#3b82f6" }],
      "created_at": "…", "updated_at": "…"
    }
  ],
  "meta": { "next_cursor": "…" }
}
```

### `POST /api/v1/contacts`

Create a contact. Scope: `contacts:write`. `phone` (E.164) is required;
`name`, `email`, `company`, and `tags` (an array of tag names, created
if missing) are optional. **Find-or-create by phone:** an existing
match returns `200` with the existing contact; a new contact returns
`201`. The response body is the serialized contact (same shape as the
list rows above).

**`consent_given: true`** — pass this when you already collected
WhatsApp-messaging consent off-platform (e.g. your own website form's
"I agree to receive WhatsApp updates" checkbox). A newly-created
contact is marked `opted_in` immediately instead of `pending` — see
[Consent tracking](#consent-tracking). Ignored for an existing contact
(find-or-create doesn't overwrite a contact's already-tracked consent
status) and for a falsy/omitted value.

### Consent tracking

Every contact gets a `contact_consent` row the moment it's created —
regardless of whether it came from a manual "Add Contact", a CSV
import, this API, or the customer messaging in first — so there's one
place to check "where did this number come from, and what's their
consent status." **Migration required:**
`supabase/migrations/070_contact_consent.sql` through `073_contact_consent_default_opted_in.sql`.

**Every new contact starts `opted_in`**, regardless of source — an
explicit account-owner decision (migration 073), so no template is
sent automatically on contact creation. `source` is still recorded
(`manual` / `csv_import` / `unknown` (API) / `whatsapp_inbound`) for
audit purposes even though it no longer affects the initial status.

The `pending` status and the batch-send endpoint below still exist for
any account that wants a stricter opt-in gate (e.g. by pausing the
073 migration or manually setting a contact back to `pending`) —
useful context if you're auditing an older dataset that still has
`pending` rows, or configuring a different account.

**`POST /api/contacts/consent/send-batch`** (dashboard session,
admin+ — not part of the API-key surface) sends a consent-request
template to a small, oldest-first batch of `pending` contacts that
have never been asked:

```json
{ "template_name": "ask_consent", "template_language": "en", "limit": 25 }
```

`limit` defaults to 25, capped at 100. Response:
`{ "data": { "attempted", "sent", "failed", "remaining_pending" } }`.
Call it again (as often as you judge safe) to work through the rest
of the backlog in further small batches — it never sends more than
`limit` in one call.

When the customer taps the template's `YES_CONSENT` / `NO_CONSENT`
quick-reply button, the webhook resolves it automatically;
`NO_CONSENT` also flips `contacts.marketing_opt_out` so the existing
broadcast-audience exclusion honors it immediately.

### `GET` / `PATCH /api/v1/contacts/{id}`

Read or update one contact. Scopes: `contacts:read` / `contacts:write`.
`PATCH` updates only the fields you send (`name`, `email`, `company`);
pass `tags` (an array of tag names) to replace the contact's tags. A
contact in another account returns `404`.

### `GET /api/v1/conversations`

List conversations, newest first. Scope: `conversations:read`.
Paginated. Optional filters: `?status=` (`open` / `pending` / `closed`)
and `?contact_id=`. Each conversation embeds its contact + tags.

### `GET /api/v1/conversations/{id}`

Read one conversation. Scope: `conversations:read`. `404` if it belongs
to another account.

### `GET /api/v1/conversations/{id}/messages`

List a conversation's messages, newest first. Scope: `messages:read`.
Paginated. Each message includes its `direction` (`inbound` /
`outbound`), `status` (delivery state), `whatsapp_message_id`, and
`content_*`. The conversation is verified to belong to your account
first (`404` otherwise).

### `POST /api/v1/broadcasts`

Launch a template broadcast to a list of recipients. Scope:
`broadcasts:send`. The broadcast + its recipient rows are persisted
immediately and the sends fan out in the background, so the call
returns fast — poll `GET /api/v1/broadcasts/{id}` for progress.

```bash
curl -X POST https://your-crm.example.com/api/v1/broadcasts \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "July promo",
        "template_name": "promo_july",
        "template_language": "en_US",
        "recipients": [
          { "to": "+14155550123", "params": ["Jane"] },
          { "to": "+14155550124" }
        ]
      }'
```

Recipients are capped at **1000 per request** — split larger sends.
Invalid phone numbers are dropped and counted as `rejected`. Response
(202):

```json
{
  "data": {
    "broadcast_id": "…",
    "status": "sending",
    "total_recipients": 2,
    "accepted": 2,
    "rejected": 0
  }
}
```

### `GET /api/v1/broadcasts/{id}`

Broadcast status + counts. Scope: `broadcasts:send`. `status` moves
`sending` → `sent`; `delivered_count` / `read_count` keep climbing as
Meta delivery webhooks arrive. `404` for another account's broadcast.

## Pagination

Every list endpoint pages the same way. Request a page size with
`?limit=` (default 50, max 100) and read the next page with the opaque
`meta.next_cursor` from the previous response:

```
GET /api/v1/contacts?limit=50
→ { "data": [ … ], "meta": { "next_cursor": "eyJ…" } }

GET /api/v1/contacts?limit=50&cursor=eyJ…
→ { "data": [ … ], "meta": { "next_cursor": null } }   // last page
```

Cursors are keyset-based (stable under concurrent inserts). Pass the
cursor back verbatim — don't parse it. `next_cursor: null` means the
last page.

## Webhooks

Rather than polling, register an endpoint and wacrm will POST to it when
things happen in your account. **Migration required:** apply
`supabase/migrations/028_webhook_endpoints.sql`.

### Events

| Event                    | Fires when                                        |
| ------------------------ | ------------------------------------------------- |
| `message.received`       | An inbound message arrives from a contact         |
| `message.status_updated` | A message you sent changed delivery status        |
| `conversation.created`   | A new conversation is opened for a contact        |

### Managing endpoints

All under scope `webhooks:manage`.

- `POST /api/v1/webhooks` — register `{ "url": "https://…", "events": ["message.received"] }`. `url` must be `https://`. **The response includes `secret` exactly once** — store it to verify signatures; wacrm keeps only an encrypted copy.
- `GET /api/v1/webhooks` — list your endpoints (never returns the secret).
- `GET /api/v1/webhooks/{id}` — read one.
- `PATCH /api/v1/webhooks/{id}` — update `url`, `events`, or `is_active` (re-enabling clears the failure counter).
- `DELETE /api/v1/webhooks/{id}` — remove one.

```bash
curl -X POST https://your-crm.example.com/api/v1/webhooks \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com/hooks/wacrm", "events": ["message.received"] }'
# → 201 { "data": { "id": "…", "url": "…", "events": [...], "secret": "whsec_…" } }
```

### Delivery payload

Every delivery is a POST with this envelope; `id` is a unique per-
delivery uuid you can dedupe on, and `data` varies by `event`:

```json
{
  "id": "8f3c…",
  "event": "message.received",
  "occurred_at": "2026-07-01T12:00:00.000Z",
  "account_id": "…",
  "data": { /* per-event, see below */ }
}
```

`data` by event:

```jsonc
// message.received
{ "conversation_id": "…", "contact_id": "…", "whatsapp_message_id": "wamid.…", "content_type": "text", "text": "Hi 👋" }
// conversation.created
{ "conversation_id": "…", "contact_id": "…" }
// message.status_updated
{ "whatsapp_message_id": "wamid.…", "conversation_id": "…", "status": "delivered" }
```

Headers: `X-Wacrm-Event`, `X-Wacrm-Webhook-Id`, and `X-Wacrm-Signature`.

### Verifying the signature

`X-Wacrm-Signature: t=<unix_seconds>,v1=<hex>` where `v1 =
HMAC-SHA256(secret, "${t}.${rawBody}")`. Recompute it over the **raw
request body** and compare in constant time; reject if `t` is more than
a few minutes old (replay protection).

```js
const [, t, v1] = header.match(/t=(\d+),v1=([0-9a-f]+)/);
const expected = crypto.createHmac('sha256', secret)
  .update(`${t}.${rawBody}`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
```

### Delivery semantics

Delivery is **best-effort**: a single attempt per event with a short
timeout, and **redirects are not followed**. `message.status_updated`
covers messages wacrm stores (inbox + API sends), not broadcast-only
sends, and — because providers re-send and re-order status callbacks —
the same status may arrive more than once or out of order; **dedupe on
`id` and don't assume ordering**. Each consecutive failure increments
`failure_count`; after enough consecutive failures the endpoint is
auto-disabled (`is_active: false`) — re-enable it with `PATCH` (which
resets the counter). Durable retry-with-backoff (a delivery queue) is a
future enhancement; today, treat missed deliveries as possible and
reconcile with the read endpoints when it matters.

**Target restrictions (SSRF).** The `url` must be `https://` and must
resolve to a public address — requests to `localhost`, private/RFC1918
ranges, link-local (incl. cloud metadata `169.254.169.254`), and similar
internal targets are refused at delivery time.

## Notification rules

Config for the ecommerce/payment/shipping notification receivers: which
WhatsApp template fires for which event, per account. **Migration
required:** `supabase/migrations/066_notification_rules.sql`. All under
scope `notifications:manage`.

### Events

| Namespace  | Events |
| ---------- | ------ |
| Ecommerce  | `order.created`, `order.paid`, `order.processing`, `order.shipped`, `order.delivered`, `order.cancelled`, `order.refunded`, `cart.abandoned` |
| Payments   | `payment.captured`, `payment.failed`, `payment.refunded` |
| Shipping   | `shipment.created`, `shipment.in_transit`, `shipment.out_for_delivery`, `shipment.delivered`, `shipment.failed`, `shipment.returned` |

### Managing rules

- `POST /api/v1/notification-rules` — create a rule: `{ "event": "order.shipped", "template_name": "order_shipped", "template_language": "en", "param_mapping": ["order.number", "order.tracking_url"] }`. `template_language` defaults to `"en"`; `param_mapping` defaults to `[]`. One rule per `event` per account — `409` if one already exists (use `PATCH` instead).
- `GET /api/v1/notification-rules` — list your account's rules.
- `GET /api/v1/notification-rules/{id}` — read one.
- `PATCH /api/v1/notification-rules/{id}` — update `template_name`, `template_language`, `param_mapping`, or `is_active`.
- `DELETE /api/v1/notification-rules/{id}` — remove one.

`param_mapping` is an ordered list of dot-paths into the receiving
webhook's normalized `data` object (documented per-receiver) — each
path is resolved and passed as the template's positional body
variables, in order. A path that doesn't resolve (typo, missing
optional field) becomes an empty string rather than failing the send.
A disabled (`is_active: false`) or unconfigured event is silently
skipped by the receiver — no template fires, nothing errors.

```bash
curl -X POST https://your-crm.example.com/api/v1/notification-rules \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "event": "order.shipped", "template_name": "order_shipped", "param_mapping": ["order.number", "order.tracking_url"] }'
```

### `POST /api/v1/ecommerce/webhook`

Generic ecommerce event receiver for a custom/non-Shopify/WooCommerce
order backend that already holds a wacrm API key. Scope:
`messages:send` — the bearer token **is** the authentication; there's
no separate payload signature to configure, unlike the payment/
shipping receivers below (which sit in front of a third-party platform
with its own signing convention). If you're on Shopify or WooCommerce,
use the built-in store connection in Settings instead — this endpoint
is for everything else.

```bash
curl -X POST https://your-crm.example.com/api/v1/ecommerce/webhook \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: your-own-event-id" \
  -d '{
        "event": "order.shipped",
        "to": "+14155550123",
        "name": "Jane Doe",
        "data": { "order": { "number": "ORD-42", "tracking_url": "https://…" } }
      }'
```

- `event` — required, one of the [ecommerce events](#events) above.
- `to` — required, E.164. Find-or-creates the contact, same as `POST /api/v1/messages`.
- `name` — optional, names a newly-created contact.
- `data` — the object `param_mapping` dot-paths (configured via [notification rules](#notification-rules)) are resolved against.
- `idempotency_key` (or an `Idempotency-Key` header, which wins) — recommended, since your own backend likely retries a failed delivery to this endpoint the same way it retries anything else.

An `event` wacrm doesn't recognize, or a recognized event with no
active rule configured for this account, is **not** an error — it
`200`s with `{ "data": { "skipped": true, "reason": "…" } }` and sends
nothing, so an account that hasn't configured a given event yet
doesn't make your delivery system treat it as a failure worth
retrying. A genuine send failure (bad phone, WhatsApp not configured,
Meta rejected the send) uses the same error codes as
`POST /api/v1/messages`.

### Payment gateway notifications (Razorpay)

Unlike the receiver above, a payment gateway posts directly to a URL
you paste into *its own* dashboard — there's no wacrm API key in that
request. **Migration required:**
`supabase/migrations/067_payment_gateway_configs.sql`.

1. `POST /api/v1/payment-gateways` (scope `notifications:manage`) — connect a gateway: `{ "gateway": "razorpay", "webhook_secret": "<the signing secret shown in Razorpay's dashboard>" }`. The response's `webhook_url` is what you paste into **Razorpay → Settings → Webhooks** (alongside the *same* secret, so both sides agree on it).
2. `GET` / `PATCH` / `DELETE /api/v1/payment-gateways/{id}` — list, rotate the secret or toggle `is_active`, or disconnect. The secret is never returned once saved.
3. Configure [notification rules](#notification-rules) for `payment.captured`, `payment.failed`, `payment.refunded` — `param_mapping` reads from `{ "payment": { "id", "amount", "currency", "email", "contact", "order_id" } }` (`amount` is already converted from paise to a 2-decimal string).

Razorpay signs each delivery with `X-Razorpay-Signature: <hex>` (HMAC-SHA256 of the raw body using your configured secret) — verified before anything else runs; an invalid signature is `401`ed with no lookups, no rule matching, and no send attempted. An event Razorpay sends that wacrm doesn't act on (e.g. `payment.authorized`), or one with no phone number in the payload, is skipped the same way as the generic receiver — `200`, nothing sent.

### Shipping / courier notifications

No single courier API dominates the way Razorpay does for payments,
so this receiver defines its own signing convention rather than
adapting to one specific carrier: the same Stripe-style HMAC scheme
wacrm's own outbound [webhooks](#webhooks) use. **Migration required:**
`supabase/migrations/068_shipping_configs.sql`.

1. `POST /api/v1/shipping-configs` (scope `notifications:manage`) — register a target: `{ "carrier": "delhivery", "webhook_secret": "<a secret you generate>" }`. `carrier` is just a label for your own reference. The response's `webhook_url` is where your shipping system (or a relay in front of your actual courier) should POST.
2. `GET` / `PATCH` / `DELETE /api/v1/shipping-configs/{id}` — list, rotate the secret / rename / toggle `is_active`, or remove.
3. Sign every request to `webhook_url` with `X-Wacrm-Signature: t=<unix_seconds>,v1=<hex>` where `v1 = HMAC-SHA256(secret, "${t}.${rawBody}")` — identical to [verifying wacrm's own outbound signature](#verifying-the-signature), just in reverse.
4. Body: `{ "event": "shipment.delivered", "to": "+14155550123", "name": "Jane Doe", "data": { "shipment": { "tracking_number": "…" } }, "idempotency_key": "…" }`. `event` must be one of the `shipment.*` [events](#events) above — anything else (or an unconfigured event) is skipped (`200`, nothing sent), same as the other receivers. `idempotency_key` (no header variant here — pass it in the body) is recommended for retried deliveries.

A missing or invalid signature is `401`ed before the body is even
parsed — no rule lookup, no send attempted.

### Delivery log

Every delivery accepted by any of the three receivers above (i.e. past
signature/auth verification) writes one row to `notification_send_logs`
(`supabase/migrations/069_notification_send_logs.sql`) — `source`
(`ecommerce` / `payment` / `shipping`), `event`, `phone`,
`template_name`, `status` (`sent` / `replayed` / `skipped` / `failed`),
and `reason` (the skip reason or error message). Any account member can
read it directly via the Supabase client (RLS-scoped, same as
`notification_rules`); there's no dedicated `/api/v1` endpoint for it
yet. This is what to check first when a customer says they didn't get
a WhatsApp notification.

## Roadmap

The public API now covers messaging, contacts, conversations,
broadcasts, and outbound webhooks — the full scope of
[#245](https://github.com/ArnasDon/wacrm/issues/245). Future ideas
(deals/pipelines, templates, flows, a delivery queue for webhooks) are
not yet scheduled.
