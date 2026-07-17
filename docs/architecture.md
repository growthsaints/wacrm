# Platform Architecture — wacrm as Multi-Tenant SaaS

Author lens: CTO-level product/platform architecture. No code, no schema syntax — structural design only.

---

## 1. Tenancy Model — Three Layers, Not One

Today's model has one tenancy layer (`account`). Production SaaS needs **three**:

```
PLATFORM  (Growth Saints — the company operating the SaaS)
   └── ORGANIZATION  (a paying customer: could be a single brand, or an agency)
          └── WORKSPACE  (a business unit under that org — e.g. one WhatsApp
                           number + its team, contacts, automations, campaigns)
```

- **Platform** — owned by Growth Saints. Never exposed to customers. Operated exclusively through the Super Admin Dashboard.
- **Organization** — the billing entity. Has a plan/subscription, a set of seats, and either:
  - **Direct organization** — one org = one brand, owns its own workspace(s) directly (most SMB customers — the current "account" model, extended to allow >1 workspace).
  - **Agency organization** — a reseller/partner that owns and manages multiple **client sub-organizations** on behalf of end customers, under a white-labeled experience.
- **Workspace** — the unit that actually owns operational data: one or more connected WhatsApp numbers, its contacts, conversations, campaigns, automations, AI config, templates. An organization can have multiple workspaces (e.g., "Brand A – India," "Brand A – UAE," each with its own number and team).

This directly resolves the Critical gap "single WhatsApp number per account" (a Workspace still maps 1:1 to *routing identity*, but an Organization can hold many Workspaces) and the High gap "agency/reseller layer" (Agency Organization → Client Organizations).

---

## 2. The Two Dashboards

### Dashboard 1 — Growth Saints Super Admin

**Who uses it:** Growth Saints employees only (platform team: sales ops, support, finance, engineering, trust & safety). Never accessible to a customer, regardless of plan.

**Purpose:** Operate the platform as a business — visibility and control across every organization, workspace, subscription, and piece of infrastructure.

**Top-level navigation (Super Admin):**
- **Overview** — platform health: active orgs, MRR/ARR, churn, message volume, WABA health across the fleet, incident banner.
- **Organizations** — searchable/filterable list of every org (plan, MRR, seats used, status: trial/active/past-due/suspended/churned). Drill into any org to see its workspaces, usage, billing history, support tickets, and — with a "support impersonation" mode (audited, time-boxed, tenant-notified) — its actual product UI, for support/debugging.
- **Agencies & Partners** — agency orgs, their client rosters, revenue share/commission tracking, white-label config approval.
- **Billing & Revenue** — subscription plans catalog (create/edit plan tiers and pricing), invoices, failed-payment queue, dunning status, revenue reports, coupon/discount management.
- **WhatsApp Fleet** — every connected WABA/phone number across all tenants: quality rating, messaging tier, ban/flag status, Meta App usage against platform-level API limits, BSP-level onboarding queue (embedded signup requests pending approval).
- **AI Usage & Cost** — platform-wide AI token consumption (even though keys are BYO in the current model, a SaaS platform will also offer a *pooled/platform-provided* AI option on paid plans — this screen governs that cost).
- **Feature Flags & Entitlements** — the plan → feature/limit matrix; toggle features per org for trials, betas, or contractual exceptions.
- **Support & Tickets** — inbound support queue, linked to org context.
- **Audit Log (platform-wide)** — every privileged action taken by any Growth Saints staff member or any tenant admin, platform-wide, immutable and searchable.
- **System Health** — background job queue depth/failures, webhook delivery failure rates, database/infra metrics, third-party dependency status (Meta API, LLM providers, payment provider).
- **Staff & Roles** — Growth Saints internal team management (see RBAC §5 — platform staff roles are entirely separate from tenant roles).
- **Compliance** — data export/erasure request queue (GDPR), retention policy config, DPA status per org.

### Dashboard 2 — Client Dashboard

**Who uses it:** everyone who works for a customer organization — from a solo business owner to an enterprise team of 100 agents — and, in white-labeled form, an agency's own end clients.

**Purpose:** the actual product — everything documented in the current app today (Inbox, Contacts, Campaigns, Automation, AI, Templates, Analytics, Settings), extended with the SaaS layer: plan/billing self-service, workspace switching, and (for agency orgs only) a client-management view.

**Top-level navigation (Client Dashboard)** — see the UI Design doc for full screen-by-screen detail; structurally:
- **Home/Dashboard**
- **Inbox**
- **Contacts**
- **Campaigns** (broadcasts)
- **Automation** (rule engine + Flow builder, unified under one section)
- **AI Agents**
- **Templates**
- **Analytics**
- **Settings** (Workspace settings, Billing/Plan, Team & Roles, API Keys, WhatsApp Numbers, Integrations, White Label — agency-tier orgs only)
- **[Agency orgs only] Clients** — a distinct top-level section, only visible to Organizations with an Agency plan, functioning as a scoped-down mirror of "Organizations" from the Super Admin view but limited to that agency's own client roster, their usage, and their billing-under-the-agency status.

A single logged-in user with access to multiple workspaces gets a **workspace switcher** in the primary nav (persistent, always visible) — this is new relative to today's single-account model.

---

## 3. Permissions — Two Independent Permission Systems

It is critical these never merge into one model:

1. **Platform RBAC** (Super Admin only) — roles: `platform_owner`, `platform_admin`, `support_agent`, `billing_ops`, `trust_safety`, `read_only_analyst`. Scoped to platform-wide resources (all orgs) or, for support roles, time-boxed org-specific access grants.
2. **Tenant RBAC** (Client Dashboard) — the existing `owner / admin / agent / viewer` model, now scoped per **Workspace** rather than a flat account, plus one new role: `org_admin` — a role that sits *above* workspace-level roles, able to manage billing, seats, and workspace creation across the whole Organization, without necessarily being an operational `owner` inside every individual workspace. This separates "who pays and administers the org" from "who runs a specific number's inbox."

Permission resolution for any action in the Client Dashboard: **Organization-level role** (can this org's plan even do this? can this user manage the org?) → **Workspace-level role** (can this user do this inside this specific workspace?) → **Feature entitlement** (does the org's plan include this capability at all?). All three must pass.

---

## 4. Modules (Product Capability Map)

Grouped by ownership boundary — each module is a bounded context with its own data, its own team ownership going forward, and its own service boundary (see §5):

| Module | Responsibility |
|---|---|
| **Identity & Access** | Auth, sessions, org/workspace membership, invitations, RBAC, SSO (Enterprise tier) |
| **Billing & Subscriptions** | Plans, entitlements, metering, invoicing, payment provider integration, dunning |
| **Conversations (Inbox)** | Messages, conversations, assignment, presence, reactions, SLA timers |
| **Contacts (CRM core)** | Contacts, tags, custom fields, segments, lifecycle stages, notes, merge/dedupe |
| **Campaigns (Broadcast)** | Campaign creation, audience resolution, scheduled/triggered send, delivery tracking |
| **Automation** | Rule-based automation engine + visual Flow bot engine (kept as two engines, unified UI) |
| **AI** | Draft/auto-reply, knowledge base/RAG, provider abstraction (BYO + platform-pooled), usage metering |
| **Templates** | Message template lifecycle, Meta submission/sync, template library/gallery |
| **Channels & Numbers** | WhatsApp number provisioning (Embedded Signup), multi-number routing, quality/health monitoring; extensible to future channels (Instagram, Messenger, SMS, email) |
| **Analytics & Reporting** | Dashboards, SLA/CSAT reporting, agent performance, campaign performance, exportable reports |
| **Integrations & API** | Public REST API, outbound webhooks, connector marketplace (Shopify/HubSpot/Zapier-class) |
| **Notifications** | In-app, email, and (future) push notification delivery across all modules |
| **Platform Admin** | Everything unique to the Super Admin Dashboard — org management, fleet monitoring, staff RBAC, compliance |
| **White Label & Agency** | Branding config, custom domains, client-roster management for agency orgs |

---

## 5. Services (Logical Service Boundaries)

The current codebase is a single Next.js monolith. Production SaaS at "thousands of businesses / millions of messages" scale should evolve into a **modular monolith with clearly separated services**, not necessarily microservices on day one — but the boundaries must be designed now so extraction is possible later without a rewrite:

1. **Web/App Service** — the Next.js application: both dashboards' UI, and the session-authenticated internal API. Stateless, horizontally scalable.
2. **Public API Service** — the `/v1` REST API, logically separable from the dashboard app even if co-deployed initially (different scaling profile: bursty, third-party traffic, needs independent rate-limit/circuit-breaking from dashboard traffic).
3. **Webhook Ingestion Service** — receives all inbound Meta webhooks (messages, statuses, template events) across every tenant. This is the platform's highest-throughput, latency-sensitive entry point and should be architected as a thin, fast ingestion layer that immediately durably enqueues work rather than processing inline (directly addressing the Critical "no background job infrastructure" gap).
4. **Engine Workers** (background job consumers, horizontally scalable, independently deployable):
   - Automation Engine Worker
   - Flow Engine Worker
   - AI Reply Worker
   - Campaign Delivery Worker
   - Outbound Webhook Delivery Worker
   - Notification Delivery Worker
5. **Billing Service** — owns subscription state, usage metering aggregation, and payment-provider webhook handling (Stripe/Razorpay-class). Isolated because billing correctness/auditability requirements are stricter than the rest of the product and because it must be resilient even if other services degrade.
6. **Meta Integration Service** — the single system-of-record for all outbound calls to Meta's Graph API across every tenant, so platform-level Meta API rate limits, WABA health, and BSP-level throughput governance are centralized rather than duplicated per tenant. This is where multi-number load distribution and failover logic lives.
7. **AI Gateway Service** — a thin proxy in front of both BYO-key calls and platform-pooled AI provider calls, centralizing token metering, per-org/per-workspace rate limiting, prompt/response logging (for the Playground and audit), and provider failover.
8. **Search/Analytics Read Layer** — a denormalized read store (materialized views or a dedicated analytics database) that dashboard and reporting queries hit, decoupled from the transactional database that the Inbox/webhook path writes to — this is the direct fix for the documented "dashboard aggregation won't scale past low-thousands of messages" limitation.

Each service communicates through the job queue (§9) and the database — not direct synchronous calls between engine workers — to keep failure domains isolated (a stalled AI provider must never block message ingestion).

---

## 6. Database — See `docs/database.md` for full design

Summarized here only as it relates to platform architecture: the database gains a **platform schema** (organizations, subscriptions, plans, platform staff, platform audit log, WABA fleet inventory) sitting alongside the existing **tenant schema** (now scoped by `workspace_id` in addition to `organization_id`), with strict RLS boundaries between platform and tenant data, and between tenants. Full detail in the database design document.

---

## 7. User Roles — Consolidated Table

| Role | Layer | Scope | Summary |
|---|---|---|---|
| `platform_owner` | Platform | All orgs | Full control, including staff/role management and billing config |
| `platform_admin` | Platform | All orgs | Operational control, cannot modify platform-owner-level config |
| `support_agent` | Platform | Time-boxed, per-org grant | Read + limited impersonation for support |
| `billing_ops` | Platform | All orgs, billing scope only | Invoices, refunds, dunning |
| `trust_safety` | Platform | All orgs | Suspend/flag orgs and WABAs for policy violations |
| `read_only_analyst` | Platform | All orgs, read only | Reporting/BI access |
| `org_admin` | Tenant | Whole Organization | Billing, seats, workspace creation, cross-workspace visibility |
| `owner` | Tenant | One Workspace | Full control of that workspace (mirrors today's owner role) |
| `admin` | Tenant | One Workspace | Settings/config, no billing |
| `agent` | Tenant | One Workspace | Operational: inbox, contacts, campaigns |
| `viewer` | Tenant | One Workspace | Read-only |
| `agency_admin` | Tenant (special) | Agency Organization | Manages client-organization roster, white-label config, does not automatically get access to client operational data unless separately granted |

---

## 8. Multi-Tenancy — Isolation Strategy

- **Logical isolation via RLS**, not physical database-per-tenant — necessary to serve "thousands of businesses" cost-effectively while millions-of-messages scale is handled via partitioning/indexing (see database doc), not per-tenant infrastructure.
- **Every tenant-scoped table carries both `organization_id` and `workspace_id`.** RLS policies key off `workspace_id` for operational data (contacts, conversations, messages) and `organization_id` for org-level data (billing, seats, workspace list).
- **Platform-schema tables are never reachable by tenant-role RLS policies at all** — enforced by schema separation, not just row filtering, so a bug in tenant RLS logic cannot leak platform data by construction.
- **Large-tenant isolation option (future, not day-one):** the architecture should not preclude, for a small number of very large enterprise customers, dedicating a separate database or read replica later — the workspace-scoped design makes this a data-migration exercise, not a redesign.
- **Agency data boundary:** an agency organization's staff have access scoped to *their own* client organizations only, never to other agencies' clients or to unrelated direct organizations — enforced identically via RLS keyed off an agency-to-client ownership table.

---

## 9. Background Jobs

A durable job queue (not the current `after()`-only pattern) becomes the backbone of the platform:

- **Job categories:** webhook-triggered reactions (automation/flow/AI dispatch), campaign delivery batches, automation wait-step resumption (replacing the cron-polling pattern with real delayed jobs), outbound webhook delivery with retry/backoff, billing usage-aggregation jobs, subscription renewal/dunning jobs, scheduled report generation, WABA quality-rating polling, data export/erasure jobs (compliance).
- **Properties required:** durability (survives a worker crash), retry with backoff and dead-lettering, per-tenant fairness (one tenant's huge campaign cannot starve another tenant's inbound message processing), priority lanes (inbound message reactions are latency-sensitive; campaign sends are throughput-oriented and can tolerate more latency), observability (queue depth, failure rate, per-job-type latency — feeding the Super Admin "System Health" screen).
- **Multi-number-aware campaign delivery**: campaign delivery jobs must be throughput-governed per WhatsApp number (respecting Meta's per-number messaging tier), not just per tenant — this is new relative to the current single-number model.

---

## 10. Storage

- **Object storage** (media: inbound/outbound chat media, avatars, flow media, knowledge-base file uploads, exported reports/CSVs, invoice PDFs) — tenant-scoped paths/buckets with lifecycle policies (retention, archival tiering for old media) and platform-level storage quota tied to plan tier.
- **A caching layer** in front of the WhatsApp media proxy (directly addressing the documented gap of re-fetching from Meta on every view) — media, once verified, is persisted rather than re-verified per view, with access still authorized per-workspace.
- **Cold storage tier** for message/media history beyond an active retention window on lower plan tiers, restorable on demand — enables cost-effective "millions of messages" scale without keeping everything on hot storage indefinitely.

---

## 11. AI — Platform-Level Design

- **Two AI cost models, both supported:**
  1. **BYO key** (current model) — kept, especially for privacy-sensitive/enterprise customers who want zero AI spend flowing through Growth Saints.
  2. **Platform-pooled AI** (new) — Growth Saints holds provider keys and meters usage against the org's plan (e.g., "500 AI replies/month included"), billed as an entitlement or overage — the primary AI monetization path for SMB self-serve customers who don't want to manage their own provider account.
- **AI Gateway service** (see §5) is the single chokepoint for both paths — this is where per-org rate limiting, cost tracking, provider failover, and prompt/response audit logging live, replacing the current per-account-only rate-limit buckets.
- **Knowledge base remains per-workspace** (not shared across an organization's workspaces by default, since different brands/numbers usually need different grounding content), with an organization-level *shared* knowledge base as an optional feature for multi-workspace orgs that want common grounding (e.g., company-wide policies) layered under workspace-specific content.
- **Platform-side AI governance:** the Super Admin "AI Usage & Cost" screen exists specifically to monitor platform-pooled spend against revenue, detect abuse (a single org driving disproportionate cost), and manage provider-level rate limits/outage failover across all tenants simultaneously — none of this exists in the current single-tenant BYO-only design.

---

## 12. Meta Integration — Platform-Level Design

- **Growth Saints becomes a Meta Tech Provider / BSP**, not a pass-through app each self-hoster configures individually. This means:
  - **Centralized Embedded Signup flow** — a client onboards their WhatsApp number through Growth Saints' own Meta App via Facebook's embedded signup flow, not by pasting their own Meta App credentials.
  - **Centralized WABA/number fleet management** — the Meta Integration Service (§5) is the system of record for every tenant's number, its quality rating, messaging tier, and any Meta-side restrictions, rolled up into the Super Admin "WhatsApp Fleet" screen.
  - **Platform-level Meta API rate-limit governance** — Meta imposes limits at the App/Business level in addition to per-number limits; with thousands of tenants sharing Growth Saints' Meta App, this must be actively managed and load-balanced, which does not exist as a concern in the current one-app-per-self-hoster model.
  - **BYO Meta App as an Enterprise-tier option** — some large customers will want to bring their own Meta Business/App for compliance reasons; the architecture should support this as an alternate path per organization, not assume centralization is universal.
- **Template submission at scale** — with thousands of tenants submitting templates, the platform needs a queued, rate-governed submission path to Meta rather than a synchronous per-request call, and a monitoring view (part of "WhatsApp Fleet") for stuck/rejected submissions across the fleet.

---

## 13. WhatsApp Cloud API — Extended Capability Surface

Beyond what exists today (text/template/media/interactive send, status webhooks), production SaaS parity requires the platform to formally support, as first-class capability areas (not just "whatever the raw Cloud API allows"):
- **Multi-number-per-workspace and multi-workspace-per-organization** routing of both inbound and outbound.
- **Commerce features** (catalog messages, product lists, WhatsApp Pay/payment links where regionally available) as a distinct module, not bolted onto the message-send path.
- **Business profile management** (about, description, business hours, catalog link) surfaced in-product rather than requiring the client to configure it directly in Meta Business Manager.
- **Compliance-aware messaging** (opt-in/opt-out tracking, 24-hour session window enforcement surfaced clearly in the composer UI, country-specific regulatory messaging rules where applicable) as an explicit product concern, not just an implicit constraint developers must remember.

---

## 14. Future Mobile App

Architected for from day one, not bolted on later:

- **The Public API (`/v1`) is the mobile app's only backend dependency** — the mobile app is architecturally just another API client, exactly like the MCP server today. This means every capability the mobile app needs (inbox, send, contacts, notifications) must exist as a public API capability, not a dashboard-only server-action.
- **Push notification service** becomes a required new platform capability (not present today) — a notification-delivery worker (§5/§9) that fans out to APNs/FCM in addition to the existing in-app/email channels.
- **Real-time on mobile** — the current web Realtime (Supabase Postgres CDC subscriptions) model extends naturally to mobile clients using the same subscription mechanism, so no separate real-time protocol is needed for mobile specifically.
- **Offline-first considerations** (queued outbound messages, cached recent conversations) are a mobile-client concern layered on top of the same API — the backend does not need bespoke mobile endpoints, only robust idempotency (already partially present via `meta_message_id` idempotency in the Flow engine — a pattern that should be generalized) so retried mobile requests after connectivity loss don't duplicate sends.
- **Scope for v1 mobile:** agent-facing inbox + contacts + notifications (parity with a "mobile Slack for support agents"), not full admin/settings/billing management, which stays desktop-first initially.

---

## 15. Billing, Subscriptions, White Label — Cross-References

Full detail lives in the database design (plan/subscription/entitlement schema) and the roadmap (phased delivery). Structurally, at the architecture level:

- **Billing Service** (§5) is the source of truth for plan, subscription status, and entitlements; every other service (feature gating in the UI, API rate limits, AI Gateway limits, campaign send caps) *reads* entitlements from it rather than each maintaining its own notion of "what this org can do."
- **White label** is modeled as **organization-level configuration** (custom domain, logo, color theme, sender name, "powered by" toggle) consumed by the Web/App Service at request time to render the Client Dashboard under the org's identity — available only to organizations whose plan/type includes it (typically Agency-tier and Enterprise-tier).
- **Subscriptions support both direct-billing organizations and agency-managed billing** (an agency may pay Growth Saints for a bundle of client seats and bill its own clients separately outside the platform, or — a further product decision for later — the platform could support pass-through sub-billing; the architecture keeps this option open by modeling the Agency→Client relationship independently of the billing relationship).
