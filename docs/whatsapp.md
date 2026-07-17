# WhatsApp Cloud API — Capability Design

No code — design only. Covers the technical capability surface of the WhatsApp integration itself, distinct from the Meta-platform/BSP relationship (see `docs/meta.md`).

---

## 1. Preserved Foundations (Sound Design, Kept)

The current implementation's core patterns are correct and carried forward unchanged in principle:
- AES-256-GCM credential encryption with dual-format (legacy CBC / current GCM) decrypt support and opportunistic re-encryption on touch.
- HMAC-SHA256 webhook signature verification on raw request bytes.
- Forward-only status-transition state machine for delivery status (`pending → sent → delivered → read → replied`, with `failed` as an early-state-only terminal branch).
- "Lost the race, re-resolve the winner" handling for concurrent contact/conversation creation.
- Media handled via a verify-then-proxy pattern rather than eager re-hosting.
- Template lifecycle synced via the same webhook endpoint, routed by `change.field`.

## 2. Multi-Number Extension

- Every conversation, message, campaign, and template becomes scoped to a specific **Number** (in addition to workspace), per the database doc — inbound webhook routing (already correctly keyed by `phone_number_id` today, including its defensive handling of the 0/1/>1-config-match cases) extends naturally, since the existing lookup-by-`phone_number_id` logic is already structured to resolve to "the config," which simply now resolves to "the Number" instead of "the account."
- The Inbox UI gains number-aware filtering (per the UI design doc); Automations/Flows gain optional number-scoping (an automation can be workspace-wide across all numbers, or scoped to a specific number, depending on the tenant's team structure).

## 3. Session Window & Compliance Surfacing

- The 24-hour customer-service session window (an implicit constraint developers must remember today) becomes an explicit, visible UI element (a countdown strip in the Inbox thread, per the UI design doc) and a first-class validation check before send (auto-suggesting the template picker when outside the window, rather than only surfacing Meta's rejection after the fact).
- Opt-in/opt-out state tracking becomes an explicit contact-level attribute, feeding both campaign audience resolution (never sending to an opted-out contact) and the platform's Meta-policy-compliance obligations as a BSP (per the Meta integration doc).

## 4. Commerce Capabilities (New Module)

- Catalog/product message support, cart/order-adjacent messaging, and payment-link sends (where regionally available on the Cloud API) are modeled as a distinct capability area with its own data entities (products/catalog references, order status), not bolted onto the existing text/template/media/interactive send path — this keeps the core messaging path's proven simplicity intact while commerce evolves independently.

## 5. Business Profile Management

- Business profile fields (about, description, business hours, catalog link, profile photo) become manageable in-product (Settings → Workspace) rather than requiring the customer to configure them directly in Meta Business Manager — a thin CRUD layer over the existing Meta Cloud API client, extending its current scope (message-centric) to profile-centric operations.

## 6. Throughput & Multi-Number Load Distribution

- Campaign delivery becomes explicitly throughput-governed per sending Number (respecting that number's current messaging tier), coordinated by the Meta Integration Service (per the architecture and Meta docs) — replacing today's simpler, single-number, single-tenant-appropriate send loop.
- For workspaces with multiple numbers, the platform can (as a product option, not a mandatory behavior) distribute a large campaign's sends across multiple numbers to increase effective throughput and reduce concentration risk on any single number's quality rating — a genuinely new capability with no equivalent in the current single-number design.

## 7. Interactive & Flow-Adjacent Capabilities

- Existing buttons/list-message support and the Flow engine's structural node-based bot model are preserved as the foundation; extended (per roadmap Phase 6) with reusable sub-flows and richer branching, and — as a distinct, larger capability — optional NLP/intent-matching as an alternative trigger mechanism alongside today's exact-keyword and button/list-tap matching, closing the identified competitive gap against NLU-capable competitor chatbot builders.

## 8. Test/Sandbox Support

- The existing `WHATSAPP_TEMPLATES_DRY_RUN` philosophy (exercise the full flow without a real Meta call) extends into a full **sandbox number** offering for trial signups (per the gap analysis' identified Medium-priority gap) — a shared or per-signup test number/WABA that lets a prospective customer experience real WhatsApp send/receive during evaluation before connecting their own production number via Embedded Signup.
