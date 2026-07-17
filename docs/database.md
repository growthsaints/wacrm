# Database Design — PostgreSQL on Supabase, SaaS Scale

Design only — no SQL. Target: millions of messages, thousands of businesses, multiple WhatsApp numbers per business, full multi-tenant RBAC, audit logs, subscriptions, campaigns, AI/knowledge base, storage — all on Supabase-managed Postgres.

---

## 1. Schema Organization

Move from a single flat `public` schema (current state) to **purpose-separated schemas**:

- `platform` — Growth Saints' own operating data: organizations, plans, subscriptions, platform staff, platform-wide audit log, WABA fleet inventory. Never touched by tenant-role RLS.
- `tenant` — everything the current `public` schema holds today (contacts, conversations, messages, campaigns, automations, flows, AI config, templates), re-scoped with `organization_id` + `workspace_id`.
- `billing` — plans, subscriptions, invoices, usage-metering records, payment-provider event log. Isolated because of stricter auditability/consistency requirements and because it's read by nearly every other schema for entitlement checks but should rarely be written by anything except the Billing Service.
- `audit` — append-only event tables (platform audit, tenant audit), physically separated so retention/partitioning/immutability policies can be applied uniformly without touching operational tables.
- `analytics` — denormalized read-optimized tables/materialized views feeding dashboards and reports, refreshed asynchronously from `tenant` — deliberately decoupled from the transactional path.

This mirrors the service boundaries in the architecture document and lets RLS policies, backup/retention policies, and access grants differ appropriately per schema rather than being one undifferentiated bucket.

---

## 2. Tenancy Keys — Every Tenant Table Carries Both

- `organization_id` — the billing/administrative entity.
- `workspace_id` — the operational unit (one or more WhatsApp numbers, its own team/contacts/conversations).

Rationale: some entities are organization-scoped (billing, seats, agency-client links, org-wide shared knowledge base) and some are workspace-scoped (contacts, conversations, messages, campaigns, automations). Carrying both columns on workspace-scoped tables (workspace_id as the primary tenancy key, organization_id denormalized for fast org-wide rollups without a join) is the deliberate trade-off — consistent with the existing codebase's own precedent of denormalizing for RLS/query performance (e.g., `broadcasts` aggregate counters).

RLS policy pattern, conceptually: a `is_workspace_member(workspace_id, min_role)` function (evolution of today's `is_account_member`) is the single predicate used everywhere, exactly as today's function is reused — this consistency principle carries forward unchanged.

---

## 3. Multi-Number Support

Today's `whatsapp_config` is `UNIQUE(account_id)` — a hard one-number limit. Redesign:

- A **Numbers** entity, one row per connected WhatsApp phone number, belonging to exactly one `workspace_id` (a workspace can now be thought of as "one number's operating context," or — depending on final product decision — a workspace can own *multiple* numbers if the product wants numbers routed within one shared inbox/team; the schema should support **many numbers per workspace**, with routing/assignment rules determining which team members or automations apply to which number, since this is the more flexible superset and doesn't preclude a "one number = one workspace" *product* configuration).
- Every message-producing/consuming table (conversations, messages, campaigns) carries a `number_id` in addition to `workspace_id`, so a workspace with multiple numbers can filter/report/route per number — directly what the Inbox UI's "number selector chip" and the Analytics module need.
- The **Numbers** entity also holds quality-rating, messaging-tier, and health-status fields, feeding both the client-facing per-number health indicator (Settings → Workspace) and the platform-wide WhatsApp Fleet view — a single source of truth read by both dashboards.

---

## 4. Platform Schema — Core Entities

- **Organizations** — the billing/admin root. Type (`direct` / `agency`), status (trial/active/past_due/suspended/churned), owning-agency reference (nullable — set only for client-orgs created by an agency), created/plan-start timestamps.
- **Workspaces** — belongs to one Organization; holds workspace-level settings (timezone, business hours) previously living on `whatsapp_config`/account-level tables.
- **Platform Staff** — Growth Saints employee accounts, entirely separate identity space from tenant `profiles` (a platform staff member is never also a tenant user by accident — enforced by being a distinct table, not a role flag on the same table, closing off an entire class of privilege-escalation risk).
- **Agency–Client Links** — join entity recording which Organizations an Agency Organization manages, when the link was established, and what management scope was granted (full vs. billing-only vs. support-only) — this is what powers both the Agency Dashboard's client roster and the RLS boundary preventing one agency from seeing another's clients.
- **Feature Flags / Entitlement Overrides** — per-organization exceptions layered on top of plan-derived entitlements (for trials, betas, negotiated enterprise deals) — a small override table checked *after* the plan's default entitlement set, not a replacement for it.
- **WABA/Number Fleet Inventory** — platform-wide rollup view over the tenant-schema Numbers entity (could be a materialized view rather than a separate physical table, since the data really lives in `tenant`, but the platform schema needs a fast, org-detail-free way to query fleet-wide health).

---

## 5. RBAC — Data Model

- **Platform roles**: a small, fixed role table (`platform_owner`, `platform_admin`, `support_agent`, `billing_ops`, `trust_safety`, `read_only_analyst`) assigned directly on the Platform Staff entity — no per-org scoping needed except for `support_agent`, which additionally requires a **time-boxed access grant** record (org reference, granted-by, expires-at) so support impersonation is never a standing permission, only a logged, expiring one.
- **Tenant roles**: the existing `account_role_enum` pattern (owner/admin/agent/viewer) evolves to be assigned **per workspace membership**, not per organization — a membership entity links a user to a specific workspace with a specific role, allowing one person to hold different roles in different workspaces of the same organization (e.g., admin of "Brand A – India," viewer of "Brand A – UAE").
- **`org_admin`** is a separate, organization-level flag/role (not a workspace membership) — org-wide administrative rights (billing, seat management, workspace creation) independent of any specific workspace's operational role, exactly as described in the architecture document.
- **Role-rank mirroring principle preserved**: whatever ordinal ranking TypeScript uses for role comparisons must be mirrored by an equivalent database-side function, exactly as today's `is_account_member`/`roles.ts` pairing — this consistency discipline is a genuine strength of the current codebase and should be explicitly carried forward as a design *rule*, not just a pattern that happens to repeat.

---

## 6. Audit Logs

Two physically separate append-only stores, both schema-enforced as insert-only (no update/delete grants to any application role — even service-role write paths only ever insert):

- **Platform audit log** (`audit` schema): every privileged action by any Platform Staff member — org suspensions, plan overrides, impersonation start/end, billing adjustments, feature-flag changes. Fields: actor (staff id), action type, target entity/id, before/after state snapshot (JSON), timestamp, source IP/context.
- **Tenant audit log** (`audit` schema, workspace/organization-scoped, readable by org_admin/owner roles within their own org only): role changes, API key creation/revocation, billing plan changes initiated by the customer, data export/deletion requests, member removal, workspace/number connection changes.
- **Partitioning**: both audit tables are time-partitioned (e.g., monthly range partitions) from day one — audit data is write-heavy, read-rarely-but-must-be-fast-when-needed, and grows unboundedly; partitioning keeps both ingestion and the occasional "search 2 years back" query performant, and enables cheap retention-policy enforcement (drop/archive old partitions rather than deleting rows).
- **Immutability enforcement**: no `updated_at` column on audit tables at all (their absence is itself a design signal — an audit row is never revised, only ever superseded by a new row).

---

## 7. Messages at "Millions" Scale

This is the highest-volume table in the system and needs specific scale treatment beyond what exists today:

- **Time-based partitioning** (e.g., monthly range partitions on `created_at`) on the Messages table (and Conversations, secondarily) — the current design has no partitioning; at millions of rows per large tenant this becomes necessary both for query performance (most reads are "recent" — the active inbox — while historical messages are read rarely) and for the storage-tiering strategy described in §10 (an old partition can be moved to cheaper storage or archived wholesale).
- **Indexing strategy**: composite indexes led by `(workspace_id, conversation_id, created_at)` for the inbox's hot-path query pattern, plus a separate index supporting the existing "resolve by Meta wamid, non-unique, scoped to conversation" lookup pattern (a pattern the current codebase already carefully accounts for in application logic — the index must match that access pattern exactly: `(conversation_id, message_id)`, not a bare unique index on `message_id`, preserving the documented non-uniqueness invariant).
- **Read/write separation**: the Inbox's live read path and the Analytics module's aggregate read path should not compete against each other or against the webhook ingestion write path — this is why `analytics` schema materialized views exist (§10), rather than every dashboard query hitting the same partitioned Messages table directly at scale.
- **Row-size discipline**: message content stays text/JSON as today; large media itself is never stored in the row (already true today via the media-proxy pattern) — this remains correct and should be explicitly preserved as a rule as the schema evolves, not accidentally regressed (e.g., by someone later adding a "cache the media blob" column directly on Messages).

---

## 8. Multiple WhatsApp Numbers — Cross-Referenced Entities

Already covered structurally in §3; the entities that must additionally carry `number_id` alongside `workspace_id` for correct multi-number scale operation: Conversations, Messages (denormalized from Conversation for query-path efficiency, exactly as `workspace_id` is denormalized), Campaigns/Broadcasts (a campaign sends from exactly one number), Templates (templates are approved per-WABA on Meta's side, so a Template row must be scoped to the Number/WABA it was submitted under, not just the workspace — this is a real schema gap relative to today's single-number assumption), and the throughput-governance job state used by the Meta Integration Service (per-number send-rate bookkeeping, not per-workspace).

---

## 9. API Keys

Evolves from today's single flat `api_keys` table into a model that additionally supports the SaaS layer:

- Keys remain **hashed-at-rest, scope-based** (unchanged principle — this is already correct).
- Keys are scoped to a **workspace** (not organization-wide by default), consistent with the rest of operational data, with an explicit `org_admin`-only capability to mint an organization-wide key that spans multiple workspaces for larger customers who want one integration across all their numbers.
- A **usage-metering linkage**: every API key's call volume feeds the same usage-metering pipeline that powers plan enforcement (§11) and the Settings → API Keys per-key usage sparkline in the UI — meaning API key usage is not just a rate-limit counter (as today) but also a billing-relevant metric, requiring it to be durably recorded (e.g., periodic rollup rows), not just held in an ephemeral in-memory limiter.
- **Platform-issued keys** (used internally by the mobile app, or by Growth Saints' own support tooling) are modeled distinctly from tenant-issued keys, living conceptually closer to the `platform` schema even though they authenticate against tenant data, so they can be inventoried/rotated/audited separately from customer-created keys.

---

## 10. Storage Design

- **Object storage remains Supabase Storage**, organized with tenant-scoped path prefixes keyed by `workspace_id` (evolving today's user/account-scoped folder pattern) — bucket-level RLS policies mirror the same `is_workspace_member` predicate used for database RLS, so the authorization model is consistent whether the resource is a row or a file.
- **Media caching layer**: a durable cache table/record (`workspace_id`, Meta media id, resolved storage path, verified-at timestamp) sits in front of the existing "verify against Meta and proxy" pattern — once a piece of inbound media has been fetched and verified once, subsequent views resolve from this record rather than re-calling Meta's API every time, directly closing the documented scaling gap.
- **Tiered retention**: an explicit `storage_tier` concept (hot/cold) on both media records and, correspondingly, on the message-partition archival policy (§7) — plans define how long media/messages stay in the hot tier before moving to cheaper archival storage, restorable on demand rather than deleted, giving the platform a lever for cost control at "millions of messages" scale without simply capping history for everyone equally.
- **Export artifacts** (CSV exports, generated reports, invoice PDFs) get their own short-retention, auto-expiring storage path — these are generated on demand and don't need indefinite storage.

---

## 11. Subscriptions & Billing

- **Plans** — a versioned catalog entity (name, price, billing interval, and a structured entitlement definition: seat limit, message-send quota, contact-storage limit, AI-usage quota, feature-flag set, whether white-label/agency features are included). Versioned so existing subscribers can stay on an older plan's terms while new signups see current pricing — a standard SaaS requirement not expressible in a flat "plan name" field.
- **Subscriptions** — one per Organization, referencing a specific Plan version, with status (trialing/active/past_due/canceled), current billing-period boundaries, and payment-provider references (external customer id, external subscription id) — the platform's own tables never store raw payment instrument data; that stays with the payment provider (Stripe/Razorpay-class), consistent with standard PCI-scope-avoidance practice.
- **Usage Metering** — periodic rollup records (per organization/workspace, per metric, per billing period: messages sent, AI tokens consumed, storage used, API calls made) computed by scheduled aggregation jobs from the operational tables, **not** computed live from raw Messages/AI-usage-log tables on every entitlement check — mirroring the same "don't aggregate hot tables on the read path" principle applied to Analytics (§7), because entitlement checks happen on nearly every write-path action (can this org send another message this period?) and must be fast.
- **Invoices** — generated per billing period from the Subscription + Usage Metering data, with line items for base plan cost and any metered overage, and a reference to the payment provider's invoice/charge object.
- **Entitlement resolution** at read time is a merge of: Plan's default entitlements → Feature-Flag overrides (platform schema, §4) → current-period Usage Metering (to know remaining quota) — a single resolved "entitlement snapshot" per organization that the AI Gateway, Campaign Delivery Worker, and Public API rate limiter all consult, so there is exactly one place this logic is computed, not reimplemented per service.

---

## 12. Campaigns at Scale

The existing `broadcasts`/`broadcast_recipients` model and its trigger-maintained aggregate-counter pattern is sound and should be preserved as a design principle (denormalized counters updated incrementally, not recomputed) — extended for SaaS scale with:

- `number_id` scoping (per §8) so throughput governance and analytics are correct per sending number.
- A **campaign delivery job** reference/state table (rather than the current implicit "loop in the request/background task") so a campaign's send progress is durable, resumable after a worker restart, and inspectable by the platform's System Health monitoring — not just implicit in row-by-row `broadcast_recipients` status alone.
- Partitioning consideration for `broadcast_recipients` at very large recipient-list scale (a single enterprise campaign could itself reach millions of rows) — same time/campaign-based partitioning logic as Messages.

---

## 13. AI & Knowledge Base at Scale

- **Knowledge base chunks** (`ai_knowledge_chunks`, today's hybrid lexical+pgvector design) is architecturally sound and preserved — extended with `workspace_id` scoping (unchanged) plus an optional `organization_id`-scoped "shared" knowledge base tier for multi-workspace organizations wanting common grounding content, as described in the architecture doc.
- **Vector index tuning**: at SaaS scale (thousands of tenants, each potentially with a non-trivial knowledge base), the pgvector index must be explicitly configured (approximate-nearest-neighbor index type and parameters appropriate to the expected row count) rather than left at defaults — a per-scale operational concern flagged here as a design requirement, not a one-time setup detail.
- **AI usage log** evolves from "admin-readable count log" into a first-class input to the Usage Metering pipeline (§11) — every AI call's token count must reliably reach both the per-workspace usage dashboard (existing UX) and the organization-level billing rollup (new requirement), meaning this table's write path becomes billing-critical and needs the same durability guarantees as the rest of the metering pipeline, not just a best-effort log.

---

## 14. Row Level Security — Design Principles Carried Forward and Extended

- **One shared predicate function per authorization axis** (`is_workspace_member`, an organization-level equivalent, and a platform-staff equivalent) — never ad hoc per-table policy logic, exactly matching the current codebase's own best practice (`is_account_member`).
- **RLS is the enforcement layer for anything reachable by the anon/authenticated client key; service-role code paths (webhook ingestion, background workers, the Billing Service, the Meta Integration Service) explicitly bypass RLS and must self-discipline scoping by `workspace_id`/`organization_id`** — this is an accepted, documented trust boundary today and remains so at SaaS scale, but the number of service-role code paths grows substantially (many more background workers), so this discipline needs to be a formally documented engineering standard (see Coding Standards doc) rather than tribal knowledge, given the larger engineering team a SaaS company implies.
- **Platform schema tables are categorically unreachable via any tenant-role RLS policy** — enforced by schema-level grants, not row-filtering alone, so a tenant-role policy bug cannot leak platform data even in principle.
- **Agency boundary enforcement**: an agency staff member's access to a client organization's *operational* data (not just the roster) requires an explicit, separately-grantable capability (mirroring the platform support-agent time-boxed grant pattern) rather than being implied automatically by the Agency–Client Link — an agency managing billing/plan for a client should not, by default, be able to read that client's customer conversation content, unless the client organization explicitly grants that.

---

## 15. Supabase-Specific Best Practices Applied

- **Auth remains Supabase Auth** for tenant users; Platform Staff accounts likewise use Supabase Auth but in a separate, non-overlapping identity space (distinct table, distinct RLS trust boundary — never the same `auth.users` row wearing two hats via a role flag).
- **Realtime subscriptions** remain the live-update mechanism for Inbox/presence, now scoped by `workspace_id` in the publication/policy design so a Realtime channel for one workspace can never leak another's row changes — an extension of the existing `messages`/`conversations` realtime publication pattern.
- **Generated columns and triggers** for denormalized/derived state (delivery status ladders, aggregate counters) — an established strength of the current schema — are the preferred mechanism over application-computed derived state wherever the computation is deterministic and row-local, kept as an explicit standing principle.
- **Idempotent, tracked migrations**: the current idempotent-SQL-file pattern is kept for safety, but paired with an explicit migration-history tracking mechanism (flagged as technical debt in the current-state analysis) — non-negotiable at SaaS scale with a larger team shipping migrations concurrently.
- **Read replicas** (a Supabase/Postgres capability) are the mechanism behind the `analytics` schema's materialized-view refresh source and any future large-tenant isolation strategy (§ architecture doc §8) — planned for as a scaling lever from the start, even if not provisioned on day one.
