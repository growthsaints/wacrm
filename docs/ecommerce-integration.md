# Connecting a custom ecommerce website to wacrm

This is a guide for onboarding **any custom-built ecommerce website**
(not Shopify or WooCommerce — those have their own one-click connectors
under **Settings → Commerce**, see below) to wacrm's WhatsApp
notification pipeline.

There is no "Connect" button for a custom website, because every
custom backend is different. Instead, your website's backend calls a
wacrm API endpoint whenever an order/payment/shipping event happens,
and wacrm sends the matching WhatsApp template. This is entirely
config + a small amount of backend code — no changes to wacrm itself
are required to onboard a new client.

> Already on Shopify or WooCommerce? Use **Settings → Commerce →
> Connect Shopify / Connect WooCommerce** instead — that's a native,
> one-click integration and this guide doesn't apply to you.

## 1. Overview

```
Your website backend  ──POST──▶  wacrm  ──▶  WhatsApp (via Meta)
   (order/payment/          /api/v1/ecommerce/webhook
    shipping event)
```

Three things need to exist before the first message can send:

1. A wacrm **API key** (Settings → API Keys).
2. An approved **WhatsApp template** for the message you want to send
   (Settings → Templates).
3. A **notification rule** mapping the event to that template
   (`POST /api/v1/notification-rules`).

Once those three exist, your website just needs to call one endpoint
per event. No wacrm-side code change is ever needed to onboard a new
client or a new template — it's all configuration.

## 2. One-time wacrm-side setup

1. **Settings → API Keys → New API Key.** Scope: `messages:send`
   (needed to actually send). If you'll also manage notification
   rules from your own scripts (rather than by hand in the dashboard),
   also grant `notifications:manage`.
2. **Settings → Templates.** Create/approve the template(s) you want
   to send (e.g. "Order Shipped", "Payment Received").
3. **Create a notification rule** — maps one event to one template:

   ```bash
   curl -X POST https://your-crm-domain.com/api/v1/notification-rules \
     -H "Authorization: Bearer wacrm_live_xxxxxxxxxxxx" \
     -H "Content-Type: application/json" \
     -d '{
           "event": "order.shipped",
           "template_name": "order_shipped",
           "template_language": "en",
           "param_mapping": ["order.number", "order.tracking_url"]
         }'
   ```

   `param_mapping` is the ordered list of fields (dot-paths into the
   `data` object you'll send — see below) that fill the template's
   `{{1}}`, `{{2}}`, … variables, in order. A template with no
   variables needs `param_mapping: []`.

   Repeat for every event you want to notify on. Full event list and
   endpoint reference: [`docs/public-api.md`](./public-api.md#notification-rules).

## 3. What the website backend needs to do

**Trigger point:** wherever your website's code already handles an
order status change (order placed, paid, shipped, delivered,
cancelled, refunded, cart abandoned), add one HTTP call.

**Endpoint:**

```
POST https://your-crm-domain.com/api/v1/ecommerce/webhook
```

**Headers:**

```
Authorization: Bearer wacrm_live_xxxxxxxxxxxx
Content-Type: application/json
Idempotency-Key: <your own unique order/event id>   (recommended)
```

**Body:**

```json
{
  "event": "order.shipped",
  "to": "+919876543210",
  "name": "Customer Name",
  "data": {
    "order": {
      "number": "ORD-1042",
      "tracking_url": "https://track.example.com/1042"
    }
  }
}
```

- `event` — one of: `order.created`, `order.paid`, `order.processing`,
  `order.shipped`, `order.delivered`, `order.cancelled`,
  `order.refunded`, `cart.abandoned`.
- `to` — customer's phone number, **E.164 format** (`+<countrycode><number>`).
- `name` — optional, used only if this is a brand-new contact.
- `data` — whatever fields your `param_mapping` reads from. Field
  names are entirely up to you — just make sure `param_mapping`
  (step 2 above) uses the same dot-paths.
- `Idempotency-Key` — recommended, so a retried call (network blip,
  timeout) doesn't send the WhatsApp message twice.

**Response codes:**

- `201` — message sent.
- `200` with `{"skipped": true, "reason": "no_rule_configured"}` — not
  an error; this event just has no rule configured yet.
- `401` / `403` — API key missing, invalid, or missing the
  `messages:send` scope.
- `400` — a required field is missing/malformed.
- `409 idempotency_in_progress` — a concurrent call with the same
  `Idempotency-Key` is already being processed; retry shortly.

## 4. Code snippets (copy-paste, then adjust)

### Node.js / Express

```js
async function notifyWacrm(event, phone, name, data) {
  const res = await fetch(
    'https://your-crm-domain.com/api/v1/ecommerce/webhook',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer wacrm_live_xxxxxxxxxxxx',
        'Content-Type': 'application/json',
        'Idempotency-Key': `order-${data.order.number}-${event}`,
      },
      body: JSON.stringify({ event, to: phone, name, data }),
    }
  );
  const json = await res.json();
  if (!res.ok) console.error('wacrm notify failed:', json);
  return json;
}

// Call this wherever your code marks an order as shipped:
await notifyWacrm('order.shipped', '+919876543210', 'Rahul Sharma', {
  order: { number: 'ORD-1042', tracking_url: 'https://track.example.com/1042' },
});
```

### PHP (cURL)

```php
function notifyWacrm($event, $phone, $name, $data) {
    $payload = json_encode([
        'event' => $event,
        'to'    => $phone,
        'name'  => $name,
        'data'  => $data,
    ]);

    $ch = curl_init('https://your-crm-domain.com/api/v1/ecommerce/webhook');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer wacrm_live_xxxxxxxxxxxx',
            'Content-Type: application/json',
            'Idempotency-Key: order-' . $data['order']['number'] . '-' . $event,
        ],
    ]);
    $response = curl_exec($ch);
    curl_close($ch);
    return json_decode($response, true);
}

notifyWacrm('order.shipped', '+919876543210', 'Rahul Sharma', [
    'order' => ['number' => 'ORD-1042', 'tracking_url' => 'https://track.example.com/1042']
]);
```

### Python (requests)

```python
import requests

def notify_wacrm(event, phone, name, data):
    payload = {"event": event, "to": phone, "name": name, "data": data}
    headers = {
        "Authorization": "Bearer wacrm_live_xxxxxxxxxxxx",
        "Content-Type": "application/json",
        "Idempotency-Key": f"order-{data['order']['number']}-{event}",
    }
    r = requests.post("https://your-crm-domain.com/api/v1/ecommerce/webhook",
                       json=payload, headers=headers)
    return r.json()

notify_wacrm("order.shipped", "+919876543210", "Rahul Sharma",
             {"order": {"number": "ORD-1042", "tracking_url": "https://track.example.com/1042"}})
```

### WordPress / custom WooCommerce hook

(Only if you want a custom event flow _in addition to_ the native
WooCommerce connector — most WooCommerce stores should just use
**Settings → Commerce → Connect WooCommerce** instead.)

```php
add_action('woocommerce_order_status_shipped', function($order_id) {
    $order = wc_get_order($order_id);
    notifyWacrm('order.shipped', $order->get_billing_phone(), $order->get_billing_first_name(), [
        'order' => ['number' => $order->get_order_number(), 'tracking_url' => '...']
    ]);
});
```

## 5. Payments (Razorpay)

If you use **Razorpay**, your website backend doesn't need to call
anything — Razorpay posts directly to wacrm:

1. `POST /api/v1/payment-gateways` (scope `notifications:manage`) with
   `{ "gateway": "razorpay", "webhook_secret": "<your Razorpay webhook secret>" }`.
2. Paste the returned `webhook_url` into **Razorpay Dashboard →
   Settings → Webhooks**, using the same secret.
3. Create notification rules for `payment.captured`, `payment.failed`,
   `payment.refunded`.

Full reference: [`docs/public-api.md`](./public-api.md#payment-gateway-notifications-razorpay).

## 6. Shipping / courier updates

No dominant courier API exists, so this uses wacrm's own signing
scheme instead of adapting to one specific carrier:

1. `POST /api/v1/shipping-configs` with `{ "carrier": "delhivery", "webhook_secret": "<a secret you generate>" }`.
2. Sign every call to the returned `webhook_url` with
   `X-Wacrm-Signature: t=<unix_seconds>,v1=<hex>` (same scheme as
   wacrm's own outbound webhooks — see
   [`docs/public-api.md`](./public-api.md#verifying-the-signature)).
3. Body shape is identical to the generic ecommerce webhook above,
   with `event` being one of the `shipment.*` events.

Full reference: [`docs/public-api.md`](./public-api.md#shipping--courier-notifications).

## 7. Full API reference

This guide covers the common path. For the complete endpoint list,
error codes, pagination, and the outbound-webhooks feature, see
[`docs/public-api.md`](./public-api.md).
