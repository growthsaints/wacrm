<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# wacrm — Software Architecture Analysis

**Repository:** github.com/growthsaints/wacrm (fork of ArnasDon/wacrm)
**Version analyzed:** 0.8.1 (2026-07-10)
**Audience:** Senior engineering team, onboarding
**Scope:** Documents what currently exists in the codebase. No rewrite recommendations beyond incremental improvement notes.

---

## 1. Overall Architecture

wacrm is a **self-hostable, single-Next.js-application CRM** built specifically around the official **WhatsApp Business Platform (Meta Cloud API)**. It is architected as a monolith with no separate backend service: the Next.js **App Router** serves both the UI (React Server/Client Components) and the entire API surface (`src/app/api/**/route.ts` handlers) from one deployable unit.

**Core architectural characteristics:**

- **BaaS-centric design.** Supabase is not just a database — it supplies Postgres, authentication (cookie-based sessions via `@supabase/ssr`), file storage (avatars, flow media, chat media), and real-time change feeds (Postgres logical replication → WebSocket) that the client subscribes to directly. There is no custom backend for auth or real-time messaging; the Next.js server only intermediates for privileged operations (webhook ingestion, encrypted-token operations, service-role writes).
- **Multi-tenant on a single database, enforced by Postgres RLS.** Tenancy is *account*-based (not user-based — see §19). Every domain table carries an `account_id`, and Row Level Security policies (backed by a `SECURITY DEFINER` helper function `is_account_member(account_id, min_role)`) are the actual authorization boundary for anything that goes through the anon/authenticated Supabase client. Server code using the **service-role key** (webhook handlers, cron, engines) bypasses RLS entirely and must manually scope every query by `account_id` — this is a deliberate, explicitly-documented trust boundary, not an oversight.
- **Two authentication planes.** (1) Human users via Supabase Auth cookies (session-based, refreshed in `middleware.ts`). (2) Machine clients via a bespoke **API key** system (`/api/v1/*`, `Authorization: Bearer wacrm_live_…`) with scope-based authorization, independent of the account-role model.
- **Webhook-driven ingestion, engine-driven reaction.** All inbound WhatsApp traffic (messages, status updates, template lifecycle events) arrives through one Meta webhook endpoint (`POST /api/whatsapp/webhook`). After validating the HMAC signature, the handler persists the raw event, and then **fans out** to three independent, mutually-aware reactive systems in a fixed precedence order: the **Flow engine** (visual bot builder) → **Automations engine** (rule-based triggers) → **AI auto-reply** (LLM). Each system is designed to yield to the one before it (documented explicitly in code comments) so exactly one "conversational owner" handles a given inbound message.
- **BYO-key philosophy for both WhatsApp and AI.** wacrm holds no shared/pooled credentials for either Meta or LLM providers. Every account supplies its own WhatsApp System User access token and its own OpenAI/Anthropic API key; these are AES-256-GCM-encrypted at rest under a single server-held `ENCRYPTION_KEY`. This removes wacrm the vendor from the data path/liability chain and is central to the "template you fork and own" positioning (see README).
- **Serverless-shaped but not serverless-locked.** The app targets Vercel/Node deployment models (uses Next's `after()` callback for post-response background work) but is documented as running equally on a single persistent Node process (Hostinger, a VPS). This duality creates real architectural tension — see §17 and §25 (in-memory rate limiter, in-memory automation "pending executions" recovered via cron rather than a queue).

**High-level component map:**

```
                         ┌─────────────────────────────┐
                         │   Meta WhatsApp Cloud API    │
                         └───────────┬─────────────────┘
                                     │ webhook (HMAC-signed)
                                     ▼
        ┌────────────────────────────────────────────────────┐
        │  Next.js App Router (single deployable)             │
        │                                                      │
        │  UI: (auth) + (dashboard) route groups (RSC/RCC)     │
        │  API: /api/**/route.ts  (dashboard-session auth)     │
        │  API: /api/v1/**/route.ts (API-key auth, public)     │
        │                                                      │
        │  Reactive engines (server-side lib/, no HTTP):       │
        │    lib/flows/engine.ts        (visual bot)           │
        │    lib/automations/engine.ts  (rule triggers)        │
        │    lib/ai/*                   (LLM draft/auto-reply) │
        │    lib/webhooks/deliver.ts    (outbound event fan-out)│
        └───────────┬───────────────────────────┬─────────────┘
                     │ @supabase/ssr (RLS-scoped)│ service-role (RLS-bypass)
                     ▼                           ▼
        ┌────────────────────────────────────────────────────┐
        │   Supabase project                                   │
        │   Postgres (36 migrations) · Auth · Storage · Realtime│
        └────────────────────────────────────────────────────┘

        Separate process (optional): mcp-server/ — Model Context
        Protocol wrapper over /api/v1, for AI assistants (Claude,
        Cursor) to drive the CRM. Communicates only over the public
        REST API — no direct DB access.
```

---

## 2. Folder Structure

```
wacrm/
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── (auth)/                 # login, signup, forgot-password (route group, own layout)
│   │   ├── (dashboard)/            # authenticated app shell (route group)
│   │   │   ├── dashboard/          # analytics home
│   │   │   ├── inbox/              # shared inbox
│   │   │   ├── contacts/           # contacts + tags + custom fields
│   │   │   ├── pipelines/          # Kanban deals
│   │   │   ├── broadcasts/         # campaign wizard (4-step)
│   │   │   ├── automations/        # rule-based automation builder
│   │   │   ├── flows/              # visual bot builder (React Flow canvas)
│   │   │   ├── agents/             # AI Agents (Playground + Setup + Usage)
│   │   │   ├── notifications/
│   │   │   ├── settings/           # WhatsApp config, templates, team, API keys, AI, appearance
│   │   │   └── dashboard-shell.tsx # shared shell chrome
│   │   ├── api/                    # ALL backend logic lives here — no separate server
│   │   │   ├── whatsapp/           # webhook, send, media proxy, templates, config, broadcast, react
│   │   │   ├── automations/        # CRUD + cron (wait-step resumption) + manual engine trigger
│   │   │   ├── flows/              # CRUD + cron + templates
│   │   │   ├── ai/                 # draft, autoreply, config, knowledge (RAG), playground, usage, test
│   │   │   ├── account/            # profile, members, invitations, API keys, ownership transfer
│   │   │   ├── invitations/        # token-based invite acceptance (public-ish)
│   │   │   ├── quick-replies/
│   │   │   └── v1/                 # PUBLIC REST API (api-key auth): contacts, conversations,
│   │   │                           #   messages, broadcasts, webhooks, me
│   │   ├── join/[token]/           # invite-link landing page
│   │   ├── layout.tsx / page.tsx   # root layout, marketing/redirect root
│   │   └── middleware.ts (via src/middleware.ts, see below)
│   ├── components/                 # React components, organized by feature domain
│   │   ├── inbox/, contacts/, pipelines/, broadcasts/, automations/, flows/,
│   │   │   settings/, dashboard/, agents/, presence/, interactive/, layout/
│   │   ├── ui/                     # shadcn/ui primitives (button, dialog, select, table, …)
│   │   └── tremor/                 # chart components (bar chart etc.)
│   ├── hooks/                      # use-auth, use-realtime, use-presence, use-can, use-broadcast-sending, …
│   ├── lib/                        # ALL business/domain logic — framework-agnostic where possible
│   │   ├── ai/                     # provider abstraction, RAG, config, usage, auto-reply, handoff
│   │   │   └── providers/          # openai.ts, anthropic.ts, shared.ts
│   │   ├── api/v1/                 # shared helpers for the public REST API (respond.ts envelopes, etc.)
│   │   ├── api-keys/               # key generation, hashing, scope model
│   │   ├── auth/                   # roles.ts (RBAC predicates), api-context.ts (API-key auth),
│   │   │                           #   account.ts, invitations.ts
│   │   ├── automations/            # rule engine: triggers, conditions, steps, wait/cron resumption
│   │   ├── contacts/               # dedupe, CSV import parsing, tag resolution
│   │   ├── dashboard/               # analytics query layer (client-side aggregation)
│   │   ├── flows/                  # visual bot engine: nodes, edges, validation, layout, Meta sends
│   │   ├── inbox/                  # conversation helpers
│   │   ├── storage/                # media upload to Supabase Storage
│   │   ├── supabase/               # client.ts (browser) / server.ts (SSR) factories
│   │   ├── webhooks/               # outbound event delivery: sign, deliver, endpoints, SSRF guard
│   │   └── whatsapp/               # Meta Cloud API client, encryption, templates, phone utils, etc.
│   ├── i18n/                       # next-intl request config
│   ├── types/                      # shared TypeScript types
│   └── middleware.ts               # Supabase session refresh + route protection (single file)
├── supabase/
│   └── migrations/                 # 36 sequential, hand-written, idempotent SQL migrations
├── messages/en.json                # next-intl translation catalog (single locale shipped)
├── mcp-server/                     # standalone Node/TypeScript MCP server (separate package.json)
│   └── src/                        # wraps /api/v1 as MCP tools for AI assistants
├── docs/                           # public-api.md, mcp.md (in-repo technical docs)
├── public/                         # static assets
├── AGENTS.md / CLAUDE.md           # instructions for AI coding agents working in this repo
├── CHANGELOG.md                    # detailed, Keep-a-Changelog-format history (primary source of
│                                    #   truth for *why* code looks the way it does — extensively
│                                    #   referenced throughout this document)
├── next.config.ts                  # security headers, CSP (report-only), cache-control policy
├── vitest.config.ts / *.test.ts    # co-located unit tests (63 test files)
└── package.json
```

**Structural conventions observed:**
- **Route groups** `(auth)` and `(dashboard)` cleanly separate unauthenticated and authenticated layouts without affecting URL paths.
- **`lib/` mirrors `app/api/`'s domains** almost 1:1 (whatsapp, automations, flows, ai, webhooks). Route handlers are thin; business logic lives in `lib/`, and is what's unit-tested (co-located `.test.ts` files sit next to nearly every non-trivial `lib/` module — 63 test files total).
- **No `services/`, `repositories/`, or ORM layer.** Data access is direct Supabase JS client calls (`db.from('table').select(...)`) scattered through `lib/` and route handlers — there is no repository abstraction layer.
- **No `pages/` directory** — App Router only, consistent with Next.js 16.

---

## 3. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | **Next.js 16.2.6** (App Router) | Server Components, Server Actions not prominently used — most interactivity is client-side fetch to `route.ts` handlers |
| UI runtime | **React 19.2.4**, React DOM 19.2.4 | |
| Language | **TypeScript** (`^6`), strict mode implied by extensive typed helpers | |
| Styling | **Tailwind CSS v4** (`@tailwindcss/postcss`), `tailwind-merge`, `tw-animate-css` | Utility-first, no CSS-in-JS |
| Component primitives | **shadcn/ui** (v4.11 CLI) + **@base-ui/react** | Copied-in, source-owned components under `components/ui/` |
| Icons | **lucide-react** | |
| Drag & drop | **@dnd-kit** (core, sortable, utilities) | Powers pipeline Kanban board |
| Visual flow builder | **@xyflow/react** (React Flow) + **@dagrejs/dagre** | Powers the Flows bot-builder canvas and auto-layout |
| Charts | **recharts**, plus a custom **Tremor**-derived bar-chart component | Dashboard analytics |
| Data/Backend platform | **Supabase** (`@supabase/supabase-js` v2.107, `@supabase/ssr` v0.12) | Postgres + Auth + Storage + Realtime, hosted or self-hosted |
| Auth | Supabase Auth (email/password) via `@supabase/ssr` cookie-based SSR client | |
| Vector search | **pgvector** Postgres extension | Optional semantic search over the AI knowledge base |
| i18n | **next-intl** (v4.13) | Single locale (`en`) shipped in `messages/en.json`; infra is multi-locale-ready |
| Notifications (toast) | **sonner** | |
| Date handling | **date-fns v4** | |
| Audio | **opus-recorder** | Client-side voice-note recording for the inbox composer |
| Testing | **Vitest v4** | Unit tests only — no e2e framework (Playwright/Cypress) present |
| Linting/formatting | **ESLint 9** (`eslint-config-next`), **Prettier 3** (+ `prettier-plugin-tailwindcss`) | |
| CI | **GitHub Actions** (`.github/workflows/ci.yml`) | lint → typecheck → test → build, on every PR/push to `main` |
| MCP server | Separate Node/TypeScript package (own `package.json`, `tsconfig.json`) | Implements Model Context Protocol, calls `/api/v1` only |
| External APIs | **Meta WhatsApp Cloud API** (Graph API), **OpenAI** and **Anthropic** LLM APIs (BYO key) | |

**Notable absences (by design, per README/CHANGELOG):** no ORM (Prisma/Drizzle), no message queue (SQS/BullMQ/etc.), no Redis/cache layer, no separate backend service, no Docker/Kubernetes manifests in the primary deploy path (Hostinger managed Node.js is the documented target), no e2e test suite, no server-side pooled/shared AI or WhatsApp credentials.

---

## 4. Authentication Flow

**Human (dashboard) authentication — Supabase Auth, cookie-based:**

1. `src/middleware.ts` runs on every matched request. It constructs a `createServerClient` from `@supabase/ssr`, wired to read/write cookies on the request/response.
2. `supabase.auth.getUser()` is called on every request. This both validates the current session **and transparently refreshes an expired access token**, which rotates the refresh token.
3. **A documented, previously-shipped bug (issue #288)** and its fix are preserved in code comments: refreshed cookies are written onto an intermediate `supabaseResponse` object by the `setAll` cookie handler, but every redirect/JSON branch in the middleware originally returned a *new* `NextResponse` that didn't carry those `Set-Cookie` headers — silently dropping the rotated refresh token and eventually "wedging" the session (user stuck, must clear cookies manually). The fix is a `withRefreshedCookies()` wrapper that copies cookies from `supabaseResponse` onto whatever response is actually returned. This is a good example of the kind of subtle SSR-auth bug this stack is prone to.
4. **Route protection in middleware:**
   - Authenticated users hitting `/login`, `/signup`, `/forgot-password` are redirected to `/dashboard` — unless an `?invite=` query param is present, in which case they're redirected to `/join/<token>` so a forwarded invite link "just works" for an already-logged-in user.
   - Unauthenticated users hitting protected path prefixes (`/dashboard`, `/inbox`, `/contacts`, `/pipelines`, `/broadcasts`, `/automations`, `/settings`) are redirected to `/login`.
   - Unauthenticated requests to `/api/whatsapp/*` (excluding the webhook itself) get a `401 Unauthorized` JSON response directly from middleware.
5. **Signup → account bootstrap.** A Postgres trigger (`handle_new_user()`, `SECURITY DEFINER`, installed in migration 001 and superseded in migration 017) fires `AFTER INSERT ON auth.users`. As of migration 017, it atomically creates: (a) a new `accounts` row owned by the new user, and (b) a `profiles` row linking `user_id` → `account_id` with `account_role = 'owner'`. This means every signup is a fresh single-user "account" (tenant) by default; joining an existing team happens later via invitation redemption, which reassigns `profiles.account_id`.
6. The trigger function wraps its body in an `EXCEPTION WHEN OTHERS` block so a profile/account bootstrap failure **does not block signup itself** — it logs a warning and lets `auth.users` insert succeed, accepting an orphaned auth user as the lesser failure mode.

**Team invitations (`account_invitations` table, migration 017):**
- Invite tokens are generated, and only the **SHA-256 hash** of the token is persisted (`token_hash`), with the plaintext returned exactly once at creation time by the API and never stored — a leaked DB snapshot cannot be used to redeem invites.
- `/api/invitations/[token]/peek` (rate-limited, `invitationPeek`: 30/min per IP) allows an unauthenticated visitor to preview which account/role an invite grants before signing up.
- Redemption is rate-limited tighter (`invitationRedeem`: 10/min).
- Invitations carry an `expires_at` and an `accepted_at`/`accepted_by_user_id` audit pair.

**Machine (public API) authentication — API keys, independent system:**
- Callers send `Authorization: Bearer wacrm_live_…`.
- `requireApiKey(request, scope?)` in `src/lib/auth/api-context.ts` extracts and validates the key, looks it up by **hash** (`findActiveKeyByHash`) — never stores plaintext — checks per-key rate limits (`publicApi`: 120/min), enforces the endpoint's required scope (`hasScope`), and asynchronously bumps `last_used_at`.
- This path uses the **service-role Supabase client** (no `auth.uid()` exists for an API-key caller), so **RLS provides no protection here** — every downstream query in `/api/v1/*` handlers must explicitly filter by `ctx.accountId`. The code comments call this out explicitly as a discipline requirement, not an automatic guarantee.
- Key capabilities are **scope-based, not role-based** — a key's permissions are exactly its granted scopes (`messages:send`, `messages:read`, `contacts:read`, `contacts:write`, `conversations:read`, `broadcasts:send`, `webhooks:manage`), independent of the role of the user who minted it. Key *creation* itself is gated to admin+ users.

**Role-based access control (RBAC), applied on top of both auth planes:**
- Four-tier hierarchy: `owner (4) > admin (3) > agent (2) > viewer (1)`, defined once in `src/lib/auth/roles.ts` as a set of pure, unit-tested predicate functions (`canManageMembers`, `canEditSettings`, `canSendMessages`, `canViewOnly`, `canDeleteAccount`, `canTransferOwnership`).
- The same ordinal ranking is mirrored **exactly** in the Postgres `is_account_member(account_id, min_role)` SQL function (a `CASE` expression), so server-side TypeScript guards and database RLS policies "speak the same language" — a deliberate consistency measure called out in code comments.
- UI-level gating uses a `useCan` hook and a `<GatedButton>` / `<RequireRole>` component pattern.

---

## 5. Database Architecture

- **Single Postgres database** (Supabase-hosted or self-hosted Postgres with the Supabase stack), no read replicas, no sharding, no separate OLAP store.
- **36 sequential SQL migration files** (`supabase/migrations/001_...sql` → `036_...sql`), each **explicitly idempotent** — using `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and `DROP POLICY/TRIGGER IF EXISTS` before every `CREATE POLICY`/`CREATE TRIGGER` (Postgres lacks `CREATE POLICY IF NOT EXISTS`). This lets operators re-run the full migration set safely, which matters because there is no migration-tracking table or framework (no Prisma Migrate / Supabase CLI migration history table referenced in the SQL itself) — migrations are applied by pasting/running SQL files directly (per README: "Supabase migrations" is a manual self-host step).
- **Extensive use of RLS as the primary authorization mechanism** for anything reachable via the anon/authenticated client keys. Every tenant table has RLS enabled and account-scoped `SELECT`/`ALL` policies driven by `is_account_member()`.
- **Extensive use of Postgres triggers** for derived/denormalized state:
  - `update_updated_at_column()` — generic `updated_at` bump trigger, applied to most mutable tables.
  - `handle_new_user()` — account/profile bootstrap on signup (see §4).
  - Broadcast aggregate-count triggers (migration 005) recompute `broadcasts.sent_count/delivered_count/read_count/failed_count` incrementally from `broadcast_recipients` status changes, rather than the application re-summing on every read.
  - Automation/flow run counters (migrations 007, 012) similarly maintain denormalized counts via triggers.
- **Supabase Realtime** is enabled via `ALTER PUBLICATION supabase_realtime ADD TABLE ...` for `messages` and `conversations` (migration 001) — the inbox and dashboard subscribe directly to Postgres change-data-capture over WebSockets (`postgres_changes` events) rather than a custom pub/sub layer.
- **Storage buckets**: Supabase Storage is used for profile avatars (migration 008, public bucket with per-user folder RLS keyed off `storage.foldername(name)[1] = auth.uid()`), flow media (migration 016), and chat media (migration 023) — each with its own bucket-scoped RLS policies.
- **Soft dependency on `pgvector`** (migration 030): `CREATE EXTENSION IF NOT EXISTS vector` for the AI knowledge base's optional semantic search. Falls back to Postgres full-text search (`tsvector`/`ts_rank`) when no embeddings key is configured — a genuinely hybrid, tiered retrieval design (see §12).
- **No connection pooling layer documented in the app** beyond whatever Supabase provides (e.g., PgBouncer on Supabase's side) — the app doesn't manage its own pool.
- **Numeric/currency handling**: `deals.value NUMERIC(12,2)` with a per-account `default_currency` (migration 021) — decimal-safe, not floating point.

---

## 6. Supabase Schema

Full table inventory across all 36 migrations, grouped by domain (columns/constraints summarized from the actual SQL read during this analysis):

**Identity & tenancy**
- `profiles` — 1:1 with `auth.users`; carries `account_id`, `account_role` (enum: owner/admin/agent/viewer), `full_name`, `email`, `avatar_url`, legacy unused `role TEXT`, `beta_features` (migration 011, array/JSON gating beta UI like Flows).
- `accounts` — tenant root. `owner_user_id` (denormalized, unique-indexed — enforces exactly one *owned* account per user), `name`.
- `account_invitations` — `token_hash` (unique), `role` (CHECK `<> 'owner'`), `expires_at`, `accepted_at`/`accepted_by_user_id`.
- `member_presence` (migration 024) — online/last-seen tracking per account member (drives presence dots in the UI).

**CRM core**
- `contacts` — `account_id`, `phone`, `name`, `email`, `company`, `avatar_url`. Phone dedup enforced via a unique constraint added in migration 022 (see §14).
- `tags`, `contact_tags` (M:M), `custom_fields`, `contact_custom_values`, `contact_notes`.

**Conversations & messaging**
- `conversations` — `account_id`, `contact_id`, `status` (open/pending/closed), `assigned_agent_id`, `last_message_text`, `last_message_at`, `unread_count`. As of migration 036, a `UNIQUE (account_id, contact_id)` index enforces exactly one conversation per contact per account (see §14/§15).
- `messages` — `conversation_id`, `sender_type` (customer/agent/bot), `content_type` (text/image/document/audio/video/location/template/interactive), `content_text`, `media_url`, `template_name`, `message_id` (Meta's wamid — explicitly **not unique**, since Meta ids can repeat across phone numbers, per code comments), `status` (sending/sent/delivered/read/failed), `reply_to_message_id` (swipe-reply threading), `interactive_reply_id` (button/list tap id), `ai_generated` (migration 033).
- `message_reactions` (migration 009) — per-`(message_id, actor_type, actor_id)` upsert target for emoji reactions.
- `message_actions`/interactive support (migration 035) — interactive message (buttons/lists) plumbing.

**Sales pipeline**
- `pipelines`, `pipeline_stages` (ordered, colored), `deals` (`pipeline_id`, `stage_id`, `contact_id`, `conversation_id`, `value NUMERIC(12,2)`, `currency`, `expected_close_date`, `status`).

**Broadcasts (campaigns)**
- `broadcasts` — `template_name`, `template_language`, `template_variables` (JSONB), `audience_filter` (JSONB), `scheduled_at`, `status` (draft/scheduled/sending/sent/failed), and denormalized aggregate counters (`total_recipients`, `sent_count`, `delivered_count`, `read_count`, `replied_count`, `failed_count`) maintained by triggers (migration 005).
- `broadcast_recipients` — per-recipient `status` (pending/sent/delivered/read/replied/failed) with timestamp columns for each transition, plus `whatsapp_message_id` (migration 003) linking back to the webhook status-update pipeline, and `error_message`.

**WhatsApp integration**
- `whatsapp_config` — one row per account (`UNIQUE(account_id)` post-017), `phone_number_id`, `waba_id`, encrypted `access_token`, encrypted `verify_token`, `status` (connected/disconnected), registration fields (migration 015).
- `message_templates` — `name`, `category` (Marketing/Utility/Authentication), `language`, `header_type`/`header_content`, `body_text`, `footer_text`, `buttons` (JSONB), `status` (Draft/Pending/Approved/Rejected), plus Meta-integration columns added in migration 014 (`meta_template_id`, quality/status sync fields consumed by the template-webhook handler).

**Automations (rule engine)**
- `automations` — `trigger_type`, `is_active`, `account_id`.
- `automation_steps` — ordered step graph per automation.
- `automation_logs` — execution audit trail (status, per-step results).
- `automation_pending_executions` — parked runs waiting on a `wait` step, drained by a cron endpoint (see §17).

**Flows (visual bot builder)**
- `flows` — root flow definition, `is_active`.
- `flow_nodes` — node graph (`node_type`, `config` JSONB, positions for the canvas).
- `flow_runs` — one active run per `(account_id, contact_id)` (partial unique index `idx_one_active_run_per_contact`, migrated from `(user_id, contact)` to `(account_id, contact_id)` in migration 017), `current_node_key`.
- `flow_run_events` — step-by-step execution log per run.
- Flow media storage bucket (migration 016).

**AI**
- `ai_configs` — one row per account: `provider` (openai/anthropic), `model`, encrypted `api_key`, `system_prompt`, `is_active`, `auto_reply_enabled`, `auto_reply_max_per_conversation`, `handoff_agent_id` (migration 033), encrypted `embeddings_api_key` (migration 030).
- `ai_knowledge_documents` — title/content per KB entry.
- `ai_knowledge_chunks` — chunked retrieval units with a generated `fts` tsvector column (lexical search) and an optional `vector` `embedding` column (1536-dim, OpenAI `text-embedding-3-small`) for semantic search.
- `ai_usage_log` (migration 033) — per-call token-count logging (counts only, no message content persisted), admin-readable, powers the Usage dashboard tab.

**Platform/ops**
- `api_keys` (migration 026) — hashed key storage, `scopes text[]`, `last_used_at`, `created_by`.
- `notifications` (migration 027) — in-app notification feed (e.g., conversation assignment).
- `webhook_endpoints` (migration 028) — outbound event subscriptions (URL, signing secret, subscribed event types) for the public webhook-delivery system.
- `quick_replies` (migration 035) — saved canned responses.

**Cross-cutting mechanisms:**
- Every tenant table gained an `account_id` column and account-scoped RLS policy in migration 017's mass rewrite, replacing the original `auth.uid() = user_id` policies. The legacy `user_id` columns were **kept**, repurposed as an audit/attribution field ("who is the agent of record") rather than the tenancy key.
- `is_account_member(target_account_id, min_role default 'viewer')` is the single reusable RLS predicate, `SECURITY DEFINER` to read `profiles` without recursive RLS evaluation, granted to `authenticated` and `service_role`.

---

## 7. API Architecture

Two parallel, architecturally distinct API surfaces, both implemented as Next.js Route Handlers (`app/**/route.ts`):

**A. Internal dashboard API (`/api/*`, excluding `/api/v1`)**
- Consumed only by the first-party React frontend.
- Authenticated via the Supabase session cookie (SSR client — `@supabase/ssr`), so **RLS is the actual enforcement layer** for most reads/writes; route handlers mostly just shape the request/response and enforce RBAC checks beyond what RLS alone expresses (e.g., "only admin+ may create an API key").
- Organized by domain: `account/`, `ai/`, `automations/`, `flows/`, `invitations/`, `quick-replies/`, `whatsapp/`.
- Not versioned, not intended for external consumption, no formal OpenAPI spec observed for this surface.
- Some endpoints intentionally use the **service-role client** even for session-authenticated calls when the operation needs to bypass RLS deliberately (e.g., inserting a message on behalf of the system, or an admin action affecting another member's row) — always paired with manual authorization checks in that case.

**B. Public REST API (`/api/v1/*`)** — documented in `docs/public-api.md`
- Explicitly designed for third-party/automation consumption — this is the same surface the `mcp-server/` package wraps.
- Authenticated via API key (`requireApiKey`, see §4), **not** cookies.
- Resource areas: `contacts`, `conversations`, `messages`, `broadcasts`, `webhooks` (endpoint management), `me` (introspection).
- Consistent **scope-gated** authorization per endpoint (`messages:send`, `contacts:write`, etc.).
- Consistent JSON error envelope produced by `lib/api/v1/respond.ts` (`unauthorized()`, `forbidden()`, `rateLimited()` helpers map to standard HTTP codes: 401/403/429).
- Rate-limited per API key (120 req/min) independent of the dashboard's per-user rate limits.
- Supports **outbound webhooks** as a first-class feature: accounts can register `webhook_endpoints` and receive `conversation.created`, `message.received`, `message.status_updated` events — delivered via `lib/webhooks/deliver.ts` with HMAC signing (`lib/webhooks/sign.ts`) and an SSRF guard (`lib/webhooks/ssrf.ts`, see §20) on the delivery target.

**Route-handler pattern observed throughout:**
- Auth/context resolution first (`requireApiKey(...)` or Supabase SSR client + explicit role check), then input validation, then a `lib/` domain function call, then a typed JSON response.
- Heavy use of Next's `after()` (App Router primitive) to **acknowledge fast, finish work in the background** — most consequentially in the webhook handler (§11) and broadcast delivery (§13), explicitly chosen over "fire-and-forget" detached promises because those are not guaranteed to complete on serverless runtimes that can freeze the function immediately after the response is sent (a bug — issue #301 — is documented as the reason for this choice).
- No GraphQL, no tRPC — plain REST/JSON throughout.

---

## 8. State Management

- **No global client state library** (no Redux, Zustand, Jotai, MobX, TanStack Query/SWR observed in `package.json`). State management is handled through a combination of:
  - **React Server Components** for initial data fetch on page load (Supabase SSR client reads directly in server components/route segments).
  - **Local component state** (`useState`/`useReducer`) for UI-only concerns.
  - **Custom hooks** encapsulating cross-cutting concerns:
    - `use-auth.tsx` — auth/session/profile context, likely the app's primary client-side context provider.
    - `use-realtime.ts` — thin wrapper subscribing to Supabase Realtime `postgres_changes` on `messages` and `conversations`, exposing `isConnected` and callback props (`onMessageEvent`, `onConversationEvent`); consumers own their own state and update it from these callbacks (i.e., no shared cache — each consuming component keeps its own copy of what it's rendering).
    - `use-presence.ts` — member online/last-seen state (backed by `member_presence` table + Realtime).
    - `use-can.ts` — thin RBAC predicate hook wrapping `lib/auth/roles.ts` against the current user's role from `use-auth`.
    - `use-broadcast-sending.ts` — client-side orchestration state for the multi-step broadcast send flow.
    - `use-total-unread.ts`, `use-unread-notifications.ts` — badge-count derivations.
  - **Server mutation → client refetch/optimistic update pattern**: components call `route.ts` handlers via `fetch`, then either rely on the subsequent Realtime event to reconcile state, or manually update local state optimistically (pattern varies by component; no single standardized data-fetching abstraction like React Query is used to unify this).
- **Realtime is the primary "live update" mechanism**, not polling — the inbox and dashboard activity feed rely on Postgres CDC events pushed over WebSocket rather than client-side interval refetching. This is a meaningful architectural choice: it ties real-time UX directly to Supabase's Realtime service being available and correctly configured (`ALTER PUBLICATION supabase_realtime ADD TABLE ...`).
- **Flow/Automation builders** (React Flow-based canvases) hold their own local editor state (`flow-editor-state.tsx`, tested in `flow-editor-state.test.ts`) representing the in-progress graph before it's serialized to `flow_nodes`/`automation_steps` on save — this is the most complex piece of client state in the app.

---

## 9. WhatsApp Integration Flow

**Outbound (CRM → customer), high level:**
1. UI action (send message from inbox composer, launch a broadcast, an automation "send message" step, or a flow "send text/buttons/list/media" node) calls into a shared sending path.
2. `whatsapp_config.access_token` is decrypted (`lib/whatsapp/encryption.ts`) and used to call the Meta Graph API via `lib/whatsapp/meta-api.ts` (1044 lines — the central Meta API client covering text sends, template sends, media upload/download, resumable uploads for template header images, and interactive message sends).
3. The outbound message is persisted to `messages` with `status: 'sending'`/`'sent'` and the Meta-returned `wamid` stored in `message_id`; delivery-state (`delivered`/`read`) is filled in later by inbound webhook status events (see §11), not by polling Meta.
4. **24-hour session window rules** are respected structurally: free-form text sends are only valid within Meta's 24-hour customer-service window; outside that window, only approved **message templates** can be sent — the codebase's template management, broadcast, automation, and flow "send" steps all funnel through Meta template semantics for out-of-window sends (per `template-send-builder.ts`, `template-validators.ts`).

**Inbound (customer → CRM):** see full detail in §11 (Webhook Flow) — this is the system's most complex and heavily-hardened code path.

**Phone number handling:** `lib/whatsapp/phone-utils.ts` centralizes E.164 normalization and a "phone variants" generator (used for retrying sends against alternate formats Meta might expect) and `isRecipientNotAllowedError` detection (Meta rejects sends to numbers outside an unapproved test list on non-production WABAs).

**Media:** Inbound media (image/video/document/audio/sticker) is **not stored by wacrm directly from Meta's CDN URL** — instead, the webhook handler verifies the media exists via a `getMediaUrl` call to Meta and stores a **proxy URL** (`/api/whatsapp/media/{mediaId}`) that the app's own media route resolves on demand (fetching from Meta using the account's access token at render time). This avoids the app having to eagerly download/re-host every inbound media file, at the cost of a Meta API round-trip per media view (unless cached elsewhere — no evidence of a CDN/cache layer for this in the code reviewed).

**Template lifecycle:** Message templates created in wacrm are submitted to Meta for approval; Meta's async approval/rejection/quality-score changes arrive via the **same webhook endpoint** on a different `change.field`, routed to a dedicated `handleTemplateWebhookChange` handler (`lib/whatsapp/template-webhook.ts`) that keeps `message_templates.status` in sync.

---

## 10. Meta Cloud API Implementation

- `src/lib/whatsapp/meta-api.ts` (1044 lines) is the sole low-level client for the Meta Graph API — no third-party WhatsApp SDK is used; all HTTP calls to `graph.facebook.com` are hand-rolled `fetch` calls.
- Responsibilities inside this module (inferred from file layout and cross-references elsewhere): sending text/template/interactive/media messages, resolving/verifying media (`getMediaUrl`, `downloadMedia`), resumable upload flow for template header images (Meta requires an app-scoped Resumable Upload handle — not a plain URL — for image-header templates; `META_APP_ID` + `META_APP_SECRET` are required specifically for this), and registration/config verification calls used when an account first connects a WhatsApp number.
- **Credential handling:** every Meta call decrypts the account's `access_token` just-in-time from `whatsapp_config` (AES-256-GCM, §20) — no long-lived decrypted token is cached in memory beyond a single request's lifecycle in the code paths reviewed.
- **Interactive messages** (`lib/whatsapp/interactive.ts`, `interactive-builder.tsx`/`interactive-preview.tsx` in the UI): buttons (max 3, Meta's Cloud API limit) and list messages (sectioned rows), used by both the Flows engine and manual inbox sends. `validateInteractivePayload` enforces Meta's structural constraints (button/row count/label-length limits) before sending, rather than relying on Meta's own error response.
- **Template send builder** (`template-send-builder.ts`) assembles the Meta-specific `components` array (header/body/button parameter substitution) from wacrm's internal template representation — this is the most Meta-API-schema-coupled piece of code outside `meta-api.ts` itself.
- **Registration** (migration 015, `whatsapp/config` routes): supports the on-platform "Embedded Signup"-style flow where wacrm walks an admin through connecting their WABA and phone number, storing `phone_number_id`, `waba_id`, and the resulting access token.
- **`WHATSAPP_TEMPLATES_DRY_RUN` env flag**: when true, template submission skips the real Meta call and synthesizes a `dry-run-<uuid>` template id — explicitly built for CI/local dev without a real WABA, a thoughtful testability accommodation.
- **Test coverage:** `meta-api.test.ts`, `meta-api.media.test.ts`, `meta-api.resumable.test.ts` — the Meta client is one of the most heavily unit-tested modules in the codebase, alongside the webhook and flow/automation engines.

---

## 11. Webhook Flow (Inbound Meta → wacrm)

Single endpoint: `POST /api/whatsapp/webhook` (`GET` on the same route handles Meta's subscription-verification handshake).

**Verification handshake (`GET`):** Meta calls with `hub.mode=subscribe&hub.challenge=...&hub.verify_token=...`. The handler fetches **every** `whatsapp_config` row (multi-tenant — one verify token per account) and tries decrypting+comparing each `verify_token` until one matches (tolerating decrypt failures on individual rows, e.g., different-format legacy tokens, without aborting the loop). On match, it echoes back `hub.challenge` as plain text and — opportunistically, fire-and-forget — upgrades a legacy CBC-encrypted `verify_token` to the current GCM format.

**Delivery (`POST`):**
1. **HMAC signature verification first**, on the **raw request body bytes** (read via `request.text()`, not `request.json()`, specifically because re-serializing JSON would change the byte sequence and break the signature check) — `x-hub-signature-256` header verified against `META_APP_SECRET` via `verifyMetaWebhookSignature`. Invalid signatures get a `401` (deliberately not `200`, so Meta's delivery dashboard surfaces the failure loudly rather than the app silently eating misconfigured events).
2. The handler returns `{status: 'received'}` with `200` **immediately**, and defers all actual processing into a `next/server` `after()` callback — chosen specifically over a detached `processWebhook(body)` promise because, on serverless platforms, the function can be frozen the instant the response is sent, which previously caused a **non-deterministic subset of inbound messages to be dropped** (contact/conversation created, but the message insert silently never landed — issue #301). `after()` keeps the function alive until the callback resolves, within `maxDuration = 60`.
3. **Event routing inside `processWebhook`:**
   - **Template lifecycle events** (`isTemplateWebhookField(change.field)`) are routed to `handleTemplateWebhookChange` and short-circuit the rest of the per-change loop — they don't share a shape with message events.
   - **Status updates** (`value.statuses`) go to `handleStatusUpdate`, which enforces a **status ladder** (`pending → sent → delivered → read → replied`) as a **forward-only state machine** — an incoming status can never regress the recipient's recorded state, and `failed` is only accepted from `pending`/`sent` (treated as terminal once reached, and refused if replayed after a success state) — explicitly defends against Meta's at-least-once delivery causing out-of-order or duplicate status webhooks from corrupting state. It mirrors the update onto both `messages.status` (by `message_id`, explicitly *not* assumed unique) and `broadcast_recipients` (by `whatsapp_message_id`), then fires an outbound `message.status_updated` webhook event to any registered third-party endpoints.
   - **Inbound messages** are matched to a `whatsapp_config` row by `phone_number_id`. The code explicitly distinguishes and logs three failure shapes for this lookup — 0 configs (unregistered number), 1 config (happy path), and **>1 configs** (a data-integrity condition that shouldn't occur post-migration-013's unique constraint, but is defensively handled by dropping the message and logging every candidate account rather than guessing) — a good example of the codebase's general "don't guess under ambiguity" posture.
4. **Per-message processing (`processMessage`)**:
   - `findOrCreateContact` — phone-normalizes, looks up via a shared `findExistingContact` helper (last-8-digit SQL pre-filter + full `phonesMatch` in JS — the *same* helper used by manual contact creation and CSV import, so all three paths agree on "same number," per issue #212), and **handles a lost race** on unique-constraint violation by re-resolving the concurrently-created row rather than erroring.
   - `findOrCreateConversation` — deliberately avoids `.single()` (which throws ambiguously on both 0 and ≥2 rows) in favor of `order(created_at ascending).limit(1)`, so that pre-existing duplicate conversations (a bug fixed in migration 036/issue #363, see §16) converge onto the oldest thread rather than compounding via repeated error-triggered inserts. Also handles the equivalent unique-violation race.
   - **Reactions** are special-cased and short-circuited before any message insert (upsert/delete against `message_reactions`, keyed on `(message_id, actor_type, actor_id)`).
   - **Swipe-reply context** (`message.context.id`) is resolved to an internal UUID via `lookupInternalIdByMetaId`, scoped to the conversation; a missing parent degrades gracefully to `null` rather than failing the insert.
   - **Media messages** call back into `meta-api.ts` to verify the media exists on Meta's side before constructing the internal proxy URL (`/api/whatsapp/media/{id}`) — a fixed bug is documented here too: `getMediaUrl`'s arguments were once swapped, silently causing every verification to fail and every inbound image to render as an empty bubble.
   - The message's `content_type` is mapped defensively into the DB's allowed CHECK-constraint set (stickers → `image`, unknown/reaction → `text`) so an unrecognized Meta message type can never fail the insert outright.
   - `isFirstInboundMessage` is computed via a `count`-only query **before** the insert, so `first_inbound_message` automation triggers fire correctly even for contacts that existed before ever messaging (e.g., CSV-imported).
5. **Fan-out, in a fixed precedence order**, all scoped to the resolved `account_id`:
   - **Flows engine** (`dispatchInboundToFlows`) runs first and is **awaited** (its `consumed` result gates what runs next) — if an active flow run consumes the message (advances or starts), the codebase explicitly suppresses the generic `new_message_received`/`keyword_match` **automation** triggers for that inbound (documented rationale: "customer is navigating the bot menu, not sending a fresh trigger word"), while relationship-level triggers (`new_contact_created`, `first_inbound_message`) still fire regardless, since those are about *who*, not *what*.
   - **Automations engine** (`runAutomationsForTrigger`) is fired **fire-and-forget** per matched trigger type, explicitly so a slow/failing automation can't delay Meta's `200 OK` — errors are caught and logged, never propagated.
   - **AI auto-reply** (`dispatchInboundToAiReply`) runs only for plain text the flow engine did *not* consume, only when no interactive reply was involved, and is **awaited inside `after()`** (not fire-and-forget) for the same freeze-risk reason as the top-level processing itself.
   - **Outbound public-API webhook** (`message.received`) is dispatched last and awaited, so a slow third-party subscriber endpoint cannot delay the internal engines above it.
   - `conversation.created` is emitted as soon as the thread is opened — deliberately **before** the reaction short-circuit, so a conversation whose first-ever inbound event happens to be a reaction still fires the event.
   - A best-effort, swallowed-on-error call (`flagBroadcastReplyIfAny`) checks whether the sender was a recent broadcast recipient and flips their `broadcast_recipients.status` to `replied` if so, advancing the parent broadcast's reply-rate metric.

This webhook handler is, by a wide margin, the most heavily commented, defensively coded, and bug-history-annotated file in the repository — a strong signal that it has been the primary source of production incidents historically (issues #212, #288, #301, #363 are all referenced by number in surrounding comments).

---

## 12. AI Modules

Location: `src/lib/ai/` (~144KB, largest single domain in `lib/` after `whatsapp/` and `flows/`).

**Provider abstraction** (`lib/ai/providers/`): `openai.ts` and `anthropic.ts` implement a shared interface (`shared.ts`) so `generate.ts` can call either provider uniformly. OpenAI uses Chat Completions; Anthropic uses the Messages API. No other providers (Gemini, local models, etc.) are wired in.

**Configuration** (`config.ts`, `types.ts`, `defaults.ts`, `validate.ts`): Each *account* (not user) has exactly one `ai_configs` row — provider, model, encrypted API key, optional encrypted embeddings key, system prompt, master `is_active` switch, and auto-reply-specific settings (enable flag, per-conversation reply cap, handoff target agent). `loadAiConfig()` centralizes decrypt-and-shape logic and deliberately distinguishes "not configured" (no row / `is_active=false`, returns `null`) from "misconfigured" (stored key fails to decrypt — likely a rotated `ENCRYPTION_KEY` — which **throws**, surfacing distinctly rather than looking identical to "AI just isn't set up"). The embeddings key is decrypted independently and its failure is swallowed (downgrades to lexical-only KB search) rather than breaking the primary chat path.

**Two consumption modes, sharing the same generation core:**
- **Draft** (`POST /api/ai/draft`) — agent-triggered, reads recent conversation history (bounded by `AI_CONTEXT_MESSAGE_LIMIT`, default 20), returns a suggested reply for the agent to edit/send. Never sends or stores anything on its own.
- **Auto-reply** (`lib/ai/auto-reply.ts`, dispatched from the webhook) — fully automated, gated behind `auto_reply_enabled`, only engages when the Flow engine didn't consume the message and the conversation has no interactive reply pending, bounded by a **per-conversation reply cap** (`auto_reply_max_per_conversation`, default 3) and an **account-wide rate limit** (`aiAutoReplyAccount`: 30/min) layered on top of the per-conversation cap specifically to prevent a burst of simultaneous inbound customer messages from exceeding the BYO provider key's own rate limit.

**Handoff mechanism** (`lib/ai/handoff.ts`, added CHANGELOG 0.8.0): when the model can't confidently help, or the customer explicitly asks for a human, or the per-conversation cap is hit, the bot (1) stays silent rather than guessing, (2) routes the conversation to a configured handoff target (specific agent or the unassigned queue) — firing the existing assignment-notification path — and (3) leaves an internal note summarizing the exchange. A per-conversation "AI paused" flag lets an agent **Take over** (pause the bot, assign to self) or **Resume AI** from an inbox banner (`ai-thread-banner.tsx`), backed by `POST /api/ai/autoreply/[id]`.

**Knowledge base / RAG** (`lib/ai/knowledge.ts`, `chunk.ts`, `embeddings.ts`, `query.ts`, `context.ts`):
- Documents (title + free text) are chunked (`chunk.ts`) and stored per-account in `ai_knowledge_chunks`.
- **Hybrid retrieval**: a Postgres-generated `tsvector` column with `ts_rank` gives lexical search that works for *every* account with zero extra credentials; an *optional* pgvector `embedding` column (populated only if an embeddings key is configured) enables semantic search, described in migration comments as "semantic-primary, topped up with lexical to fill the result set." Anthropic-only accounts (Anthropic offers no embeddings API) transparently stay on the lexical-only path.
- Retrieved excerpts are injected into both the draft and auto-reply prompts; the system prompt instructs the model to hand off/say-it-will-follow-up when the KB doesn't cover the question, rather than hallucinate.
- A **Reindex** action lets an admin backfill embeddings retroactively after adding an embeddings key.

**Usage/cost tracking** (`lib/ai/usage.ts`, `ai_usage_log` table): every draft/auto-reply call logs provider token counts (input/output, no message content) per mode/model, surfaced in an admin-only **AI Agents → Usage** dashboard tab.

**Playground** (`POST /api/ai/playground`): lets an admin test the *exact same code path* as the production auto-reply bot (same retrieval, same provider call) before flipping the account's master switch on — explicitly reuses `requireActive: false` in `loadAiConfig` to allow testing pre-activation.

**Security posture specific to AI:** provider keys and the optional embeddings key are AES-256-GCM-encrypted at rest (same primitive/key material as WhatsApp tokens); never returned to the client after initial save; a `POST /api/ai/test` endpoint validates a freshly-entered key against the provider before it's persisted, so a bad paste is caught immediately in the settings UI rather than surfacing later as a silent auto-reply failure.

---

## 13. Campaign System (Broadcasts)

- **Domain model**: `broadcasts` (a campaign) + `broadcast_recipients` (per-recipient fan-out and delivery/read/reply state) — see full schema in §6.
- **Dashboard UI flow** is an explicit 4-step wizard (`components/broadcasts/step1-choose-template.tsx` → `step2-select-audience.tsx` → `step3-personalize.tsx` → `step4-schedule-send.tsx`), backed by `use-broadcast-sending.ts` for client-side send orchestration state.
- **Audience selection**: `audience_filter` (JSONB) captures the segmentation criteria (tags, custom fields per migration 025's "filter contacts by tags" support), resolved server-side into a concrete recipient list at send time.
- **Personalization**: per-recipient variable substitution into the approved Meta template's placeholders (`{{1}}`, `{{2}}`, …), via `template_variables` plus recipient-specific overrides.
- **Two send paths that share one core**: the dashboard wizard, and the **public API** (`POST /api/v1/broadcasts`, scope `broadcasts:send`) — both funnel through `lib/whatsapp/broadcast-core.ts`, which is explicitly split into two phases:
  - `createBroadcast()` — synchronous: validates input, resolves the recipient list (reusing the same `findOrCreateContact` helper the webhook and CSV import use, so a broadcast recipient not yet in the CRM gets created consistently), inserts the `broadcasts` row and one `pending` `broadcast_recipients` row per recipient, and returns a plan — fast enough to run in the request/response cycle.
  - `deliverBroadcast()` — the actual per-recipient Meta template send loop (including phone-variant retry logic for numbers Meta might reject in one format but accept in another), executed in the background via `after()` so a large recipient list doesn't block the HTTP response or risk a platform timeout.
- **Delivery tracking loop-back**: each `broadcast_recipients` row stores the Meta-returned `whatsapp_message_id`; the **same inbound webhook status handler** (§11) that updates `messages.status` also updates the matching `broadcast_recipients` row by that id, and the migration-005 trigger recomputes the parent `broadcasts` aggregate counters automatically — meaning broadcast analytics are never separately computed/cached by application code, they're always live-derived from `broadcast_recipients` state via triggers.
- **Reply attribution**: `flagBroadcastReplyIfAny` (called from the webhook's inbound-message path) marks the most recent still-unreplied `broadcast_recipients` row for a contact as `replied` on any inbound message from them — a heuristic ("most recent broadcast, regardless of whether the reply is actually *about* that broadcast") rather than true conversational attribution, documented as best-effort and non-blocking.
- **Rate limiting**: broadcast *dispatch* (launching a campaign) is capped at 5/min per user (`RATE_LIMITS.broadcast`) — this bounds how often a user can *start* a campaign, not the per-message throughput within one campaign, which is instead naturally bounded by sequential/batched sends to Meta inside `deliverBroadcast()`.

---

## 14. Contacts System

- Core table `contacts` (§6) plus `tags`/`contact_tags` (M:M), `custom_fields`/`contact_custom_values` (EAV-style dynamic fields), and `contact_notes`.
- **Deduplication is a first-class, shared concern**, not an afterthought:
  - `lib/contacts/dedupe.ts` (`findExistingContact`, `phonesMatch`, `isUniqueViolation`) is the **single source of truth** for "is this the same contact," consumed identically by: manual contact creation (contact form), CSV import, the WhatsApp webhook's inbound contact resolution, and broadcast recipient resolution. The matching strategy pre-filters candidates in SQL by the phone number's last 8 digits (cheap index-friendly narrowing) then applies a stricter `phonesMatch` comparison in JS on the small candidate set — balancing correctness (handling country-code/formatting variance) against not scanning every contact row per lookup.
  - **Migration 022** added a genuine DB-level unique constraint on normalized phone per account, so dedup is enforced at the database, not just application logic — and every insert path (webhook, form, import) explicitly handles the resulting unique-violation race by re-resolving to the winning row instead of erroring out (documented pattern repeated in §11).
- **CSV import** (`lib/contacts/parse-contact-csv.ts`, `components/contacts/import-modal.tsx`): parses uploaded CSVs, resolves/matches tag names to existing tag rows or creates new ones (`resolve-import-tags.ts`), and runs each row through the same dedupe path as everything else.
- **Custom fields**: account-defined (`field_name`, `field_type`, `field_options` JSONB for e.g. select options), with per-contact values in a separate EAV table — a flexible-schema pattern that trades query simplicity for schema flexibility (custom-field-based filtering/segmentation requires joining/pivoting this table rather than a simple `WHERE`).
- **Contact detail view** (`contact-detail-view.tsx`, 28KB) aggregates a contact's tags, custom field values, notes, associated deals, and conversation history in one place — the largest single component in the `contacts/` domain.

---

## 15. Inbox Architecture

- The **shared inbox** is the flagship UI surface: `components/inbox/` is the largest single component domain by file size (164KB) — `message-thread.tsx` alone is 44KB, `message-composer.tsx` is 32KB.
- **Conversation-centric model**: one conversation per `(account, contact)` pair (enforced at the DB level as of migration 036 — see below), with `status` (open/pending/closed), `assigned_agent_id` for per-conversation ownership, and denormalized `last_message_text`/`last_message_at`/`unread_count` for fast list rendering without a join/aggregate on every render.
- **Real-time updates**: `use-realtime.ts` subscribes to `postgres_changes` on both `messages` and `conversations`; `conversation-list.tsx` and `message-thread.tsx` consume these events to update without polling.
- **Presence**: `presence-dot.tsx`/`presence-heartbeat.tsx` + `use-presence.ts`/`member_presence` table show which teammates are currently online — a lightweight collaborative-inbox signal (not full "who's viewing this conversation now" typing-indicator granularity, based on what's present).
- **Message composer capabilities**: text, media attachment (`storage/upload-media.ts`), voice notes (via `opus-recorder`), quick replies (`quick-reply-picker.tsx` / `quick_replies` table), template picker for out-of-window sends (`template-picker.tsx`), swipe-reply quoting (`reply-quote.tsx`), and reactions (`message-reactions.tsx`).
- **A significant historical bug, now fixed** (migration 036, CHANGELOG 0.8.1, issue #363): before this fix, a race condition (Meta webhook retries, or concurrent delivery fan-out) could create **multiple conversation rows for the same contact**. Because the original lookup used `.single()` (which errors ambiguously on both zero *and* multiple matching rows), once a duplicate existed, *every subsequent inbound message* for that contact hit the ambiguous-error path and created yet another conversation — a self-reinforcing, unbounded-growth bug ("snowballing into a wall of duplicate chats," per the CHANGELOG's own description). The fix: (a) the lookup now uses `order(created_at asc).limit(1)` instead of `.single()`, converging all future writes onto the oldest thread, and (b) a `UNIQUE (account_id, contact_id)` index makes single-conversation-per-contact an enforced database invariant, not just an application convention. The migration itself also merges any pre-existing duplicate conversations (and their messages) into the oldest surviving thread as part of its up-migration — a rare example of a migration doing non-trivial data repair, not just schema change.
- **Interactive message support**: buttons/list replies render distinctly in the thread (via `interactive_reply_id`) and are consumable by both the Flow engine (menu navigation) and Automations (`interactive_reply` trigger).
- **Message actions** (migration 009/`message-actions.tsx`): reactions and (implied by table naming) other per-message agent actions beyond sending.

---

## 16. Template Management

- `message_templates` table (§6) mirrors Meta's WhatsApp message template model: `category` (Marketing/Utility/Authentication — Meta's official categories, enforced via CHECK constraint), `header_type` (text/image/video/document), `body_text`, `footer_text`, `buttons` (JSONB), and a `status` lifecycle (Draft → Pending → Approved/Rejected) that mirrors Meta's own async approval pipeline.
- **UI**: `components/settings/template-manager.tsx` (44KB — one of the largest single components in the app) provides the template creation/editing form, live preview, and submission-status display.
- **Submission to Meta**: `POST /api/whatsapp/templates/submit` sends the template to Meta's Graph API for approval. Image-header templates require Meta's **Resumable Upload** protocol (an app-scoped media handle, not a plain URL) — this is why `META_APP_ID` (in addition to `META_APP_SECRET`) is required specifically for templates with image headers; text-only templates work without it.
- **Async status sync**: Meta's approval/rejection/quality-score updates arrive on the **same webhook endpoint** used for messages, but on a distinct `change.field`, routed by `isTemplateWebhookField()` to `handleTemplateWebhookChange` (`lib/whatsapp/template-webhook.ts`) — keeping `message_templates.status` current without any polling.
- **Validation** (`template-validators.ts`, `template-components.ts`): structural validation of button counts, character limits, and placeholder syntax (`{{1}}`, `{{2}}`, …) before submission — front-loading Meta's own rejection rules so users get fast, local feedback rather than round-tripping to Meta's API for basic mistakes.
- **Send-time assembly** (`template-send-builder.ts`): converts wacrm's internal template + per-recipient parameter values into the exact `components` array shape Meta's send API expects — this is the piece reused identically by manual sends, broadcasts, automations, and flow "send template" steps, so template semantics are consistent across every calling context.
- **Status normalization** (`template-status-normalize.ts`): Meta's webhook payloads for template status use their own vocabulary; this module maps them onto wacrm's internal `status` enum consistently.
- **Dry-run mode** (`WHATSAPP_TEMPLATES_DRY_RUN`): lets CI/local dev exercise the full template UI and submission flow without a real Meta WABA connection.

---

## 17. Automation Engine

Location: `src/lib/automations/engine.ts` (757 lines) — the **rule-based** automation system (distinct from the visual Flow builder in §-adjacent discussion below; both exist simultaneously and are explicitly designed to not conflict, see §11).

- **Model**: an `automation` has a `trigger_type` (e.g. `new_contact_created`, `first_inbound_message`, `new_message_received`, `keyword_match`, `interactive_reply`, `tag_added`, `conversation_assigned`, and others inferable from `AutomationContext`'s fields) and an ordered sequence of `automation_steps`. Steps include (from imported types): `send_message`, `send_buttons`/`send_list` (interactive), `send_template`, `send_webhook`, `tag` (add a tag), `update_contact_field`, `wait`, `condition` (branching), `create_deal`, `assign_conversation`.
- **Dispatch entrypoint** (`runAutomationsForTrigger`): **must never throw** — the entire body is wrapped so failures are caught and logged, since callers use it fire-and-forget from the webhook's hot path. Before touching any caller-supplied `contactId`, it explicitly re-verifies the contact belongs to the calling `accountId` — necessary because this function runs under the **service-role client** (bypassing RLS) and can also be invoked directly via a manual `POST /api/automations/engine` endpoint whose `contactId` is attacker/caller-controlled input, not something the webhook itself derived; a forged/foreign contact id is silently refused (not a distinguishable error, to avoid a UUID-existence oracle).
- **Trigger matching** (`triggerMatches`): beyond just matching `trigger_type`, some triggers carry additional match config stored per-automation (e.g. `KeywordMatchTriggerConfig` for keyword triggers, `InteractiveReplyTriggerConfig` for matching a specific button/list reply id) — evaluated against the `AutomationContext` passed at dispatch time (`message_text`, `interactive_reply_id`, `tag_id`, `agent_id`, etc.).
- **Wait steps and cron-based resumption**: because the app has no message queue or durable scheduler, a `wait` step parks the run as a row in `automation_pending_executions` with a due timestamp, and a scheduled external pinger hits `GET /api/automations/cron` (protected by a shared secret, `AUTOMATION_CRON_SECRET`) to drain due rows and call `resumePendingExecution()` for each. **This is an architecturally significant constraint**: automation "wait" delays are only as timely/reliable as whatever external scheduler (cron job, uptime-monitor-as-pinger, etc.) the self-hoster sets up to call that endpoint — there's no in-process scheduler, and if the operator never configures the cron caller, wait steps simply never resume. The README/env-example explicitly documents this requirement ("Required if you use Wait steps in automations").
- **Outbound integrations from within steps**: `send_webhook` steps call arbitrary account-configured URLs and are run through the same SSRF guard (`isDeliverableUrl`) as the public webhook-delivery system (§20) — a good instance of shared security infrastructure rather than a second, weaker implementation.
- **Meta sends from the engine** (`meta-send.ts`) reuse the shared Meta API client rather than a parallel implementation.
- **Precedence with Flows**: as documented in §11, the webhook suppresses content-based automation triggers (`new_message_received`, `keyword_match`) when the Flow engine already consumed the inbound message — Automations still get relationship-based triggers (`new_contact_created`, `first_inbound_message`) regardless.
- **Audit trail**: `automation_logs` records execution attempts with step-level results (`AutomationLogStepResult`), giving operators visibility into why an automation did or didn't fire as expected.

---

## 18. Analytics Implementation

- **Dashboard** (`(dashboard)/dashboard/`, `lib/dashboard/queries.ts` + `types.ts` + `date-utils.ts`): metric cards (open conversations, new conversations/contacts today vs. yesterday, open deals, messages today vs. yesterday), a conversations-over-time chart, a response-time distribution chart, a pipeline-value donut, and a cross-module activity feed.
- **Implementation model — explicitly, deliberately client/request-side aggregation, not pre-computed:** every metric in `loadMetrics()` and related functions is computed via **live Supabase queries** at request time (parallel `Promise.all` of `count`-mode `select`s, date-bucketed queries, etc.) — there are **no materialized views, no scheduled aggregation jobs, no OLAP/analytics database**. The code comments in `lib/dashboard/queries.ts` **explicitly acknowledge this as a scale-bounded choice**: *"RLS scopes every query to the signed-in user automatically... Perf is acceptable for the current scale (low thousands of messages) — if a tenant's dataset outgrows this, we'd migrate the heavy aggregations to SQL RPCs."* This is a rare and valuable case of the codebase pre-documenting its own known scaling ceiling (see §25).
- **Response-time metrics** (`ResponseTimeBucket`/`ResponseTimeSummary` types): computed from message timestamp deltas — the specific bucketing/percentile logic lives in `queries.ts` (not independently reviewed line-by-line here, but the type shapes indicate histogram-style bucketing rather than raw averages only).
- **Broadcast analytics**: as covered in §13, these are **not** part of the generic dashboard query layer — they're continuously trigger-maintained aggregate columns on the `broadcasts` row itself (migration 005), so broadcast performance numbers are cheap to read (no aggregation at read time) at the cost of write-time trigger overhead on every `broadcast_recipients` status change.
- **Pipeline analytics** (`components/pipelines/pipeline-analytics.tsx`): deal value/count breakdowns by stage, computed similarly to dashboard metrics (live query, not materialized).
- **AI usage analytics** (§12): a dedicated, admin-only chart of token spend, sourced from `ai_usage_log` — the one analytics surface with an explicit append-only log table backing it, rather than derived aggregation over transactional tables.
- **No third-party analytics/observability product integration** (no Segment, Mixpanel, Amplitude, Sentry, Datadog, etc.) was found in dependencies — error visibility relies on `console.error`/`console.warn` logging (extensively used, especially in the webhook handler) captured by whatever the hosting platform's log viewer is (Hostinger's "live application logs in the same UI," per the README).

---

## 19. Multi-User Architecture

- **Tenancy model: account-based, not user-based**, introduced wholesale in migration 017 (`017_account_sharing.sql`) as a deliberate, carefully-staged evolution from the original single-tenant-per-user (migration 001) design. The migration's own header comments describe the intent precisely: *"Post-apply behaviour is identical to before until a teammate is invited."*
- **One membership per user** (explicitly "the locked design decision — single membership," per code comments): a user belongs to exactly one account at a time, recorded directly on `profiles.account_id`/`profiles.account_role` rather than via a separate many-to-many `memberships` table — a deliberate simplicity trade-off ("this keeps reads cheap (one row, already loaded by the auth hook)") that would need to be revisited if wacrm ever needed to support a user belonging to multiple accounts (e.g., an agency managing several client accounts under one login).
- **Every user gets a personal account automatically at signup** (the `handle_new_user()` trigger), so **solo use requires zero setup** — the multi-user machinery is entirely latent/invisible until a first teammate is invited, per the README's positioning ("Solo use stays single-user with zero setup").
- **Four-role hierarchy** (owner/admin/agent/viewer) — see §4 for the full RBAC predicate model, mirrored identically between TypeScript (`roles.ts`) and Postgres (`is_account_member()`).
- **Invitation-based team growth** (§4): link-based invites (not per-email-address invites requiring an email-sending integration — no transactional email provider like Postmark/SendGrid/Resend appears in dependencies, so invites are shareable links the admin distributes manually, e.g., via their own email/Slack), with hashed tokens, expiry, and role pre-assignment baked into the invite itself.
- **Ownership transfer** (`api/account/transfer-ownership/`): an owner-only, explicitly gated operation (`canTransferOwnership`) to hand the account to another existing member — necessary because `accounts.owner_user_id` is a hard `NOT NULL` FK with `ON DELETE RESTRICT` (a user who owns an account **cannot** have their `auth.users` row deleted while they're still the owner — ownership must be transferred or the account deleted first).
- **Member management UI**: `components/settings/members-tab.tsx` (24KB) — list members, change roles, remove members, all funneled through the `/api/account/members` route which is explicitly documented as "admin-only, server-side" (i.e., role changes are never a client-side-trusted RLS-only operation; the route handler performs its own authorization check before mutating another user's role, since a member should never be able to edit their own role via the general profile-update RLS policy — the RLS policy for `profiles` UPDATE only allows a user to edit their *own* row, and doesn't grant role-change ability to anyone via direct table access at all, by design).
- **Cross-cutting effect of the account model**: essentially every domain table's RLS policy, every `lib/` query, and both API surfaces (§7) had to be rewritten to scope by `account_id` instead of `user_id` — migration 017 is, by line count and scope, the single largest and most consequential migration in the repository, touching RLS policies on contacts, conversations, messages, pipelines, deals, broadcasts, automations, flows, and more, in one migration file.
- **Presence** (`member_presence`, migration 024) is account-scoped, so teammates see each other's online status within their shared inbox specifically (not globally across unrelated accounts).

---

## 20. Security Implementation

**Credential encryption:**
- WhatsApp access tokens, WhatsApp verify tokens, and AI provider/embeddings API keys are all encrypted at rest using **AES-256-GCM** under a single server-held `ENCRYPTION_KEY` (64 hex chars / 32 bytes), implemented once in `lib/whatsapp/encryption.ts` and reused by the AI config module.
- The module **explicitly documents why GCM over the predecessor CBC scheme**: CBC without a MAC is unauthenticated, so an attacker able to write to `whatsapp_config` rows (directly, via a future RLS bug, or a tampered backup) could flip ciphertext bits without a decrypt failure — in the worst case, mutated bytes could coincidentally form a valid token, silently sending messages under a spoofed identity. GCM's 16-byte auth tag makes any tampering fail decryption hard, rather than silently.
- **Backward-compatible dual-format decryption**: `decrypt()` auto-detects legacy CBC (`iv:ciphertext`, one colon) vs. current GCM (`iv:ciphertext:authTag`, two colons) by counting delimiters, so pre-upgrade rows keep working; `encrypt()` only ever produces the new GCM format, and call sites opportunistically re-encrypt legacy rows to GCM when they're touched (observed in the webhook's `GET` verification handler for `verify_token`).
- **Key rotation is a manual, all-or-nothing operation**: rotating `ENCRYPTION_KEY` orphans every previously-encrypted value — every account with a WhatsApp connection or AI key must re-enter it. This is documented plainly in the `.env.local.example` file rather than glossed over.

**Webhook authenticity:**
- Inbound Meta webhooks are HMAC-SHA256-verified against the **raw request body bytes** and `META_APP_SECRET` before any processing (§11) — a `401`, not silent-ignore, on mismatch.
- Outbound webhooks (to third-party `webhook_endpoints`) are **signed** (`lib/webhooks/sign.ts`) so subscribers can verify authenticity, and are protected on the *sending* side by an **SSRF guard** (`lib/webhooks/ssrf.ts`, §6): before delivering to any account-configured URL, the resolved IP(s) are checked against loopback/private/link-local/CGNAT/ULA ranges (both IPv4 and IPv6, including IPv4-mapped IPv6), and obviously-internal hostnames (`localhost`, `*.local`, `*.internal`) are rejected outright — combined with `redirect: 'manual'` at the fetch call site so a URL that resolves publicly can't 3xx-redirect to an internal target. The module **explicitly documents its own residual gap**: it does not defend against DNS rebinding (a host resolving public at check-time but flipping to a private IP at connect-time), since that requires pinning the resolved IP into the socket, which `fetch` doesn't expose — an honestly-flagged limitation rather than a false sense of completeness. The same SSRF guard is reused for automation `send_webhook` steps (§17), avoiding a second, weaker implementation.

**Row Level Security** as the primary DB-layer authorization mechanism — see §5/§6/§19 for full detail. The `is_account_member()` `SECURITY DEFINER` function is the sole shared predicate.

**API key security** (§4/§7): keys are stored **hashed only**; scope-based (not role-based) authorization; per-key rate limiting; unauthorized/unknown/revoked/expired keys are **indistinguishable on the wire** (`unauthorized()` for all cases) specifically to prevent a key-existence oracle for probing attackers.

**Invitation token security** (§4): tokens are stored as **SHA-256 hashes only**; the plaintext is returned exactly once, at creation; rate-limited peek/redeem endpoints.

**HTTP security headers** (`next.config.ts`, §-referenced in multiple sections): HSTS (`max-age=63072000; includeSubDomains; preload`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and a **restrictive `Permissions-Policy`** that denies camera/geolocation/payment/USB outright and allows microphone only for `self` (specifically to support the inbox's in-browser voice-note recorder) — framed in comments as defense against a compromised dependency silently requesting device access. A **Content-Security-Policy is shipped in `Report-Only` mode**, not enforced — the code comments state the intent to flip it to enforcing once confidence is established across two deploys with no violations; **as of this analysis, CSP is not actually blocking anything**, only logging violations to the browser console — a real, explicitly-acknowledged gap (not a hidden one).

**Rate limiting** (`lib/rate-limit.ts`, §6/§17): an **in-memory, single-process, fixed-window counter** covering per-user message sends (60/min), broadcast dispatch (5/min), reactions (120/min), invitation peek/redeem, admin actions (30/min), the public API (120/min per key), and three distinct AI-related buckets (per-user draft, per-account draft, per-account auto-reply) specifically layered to prevent N agents each individually under their own limit from collectively exceeding the account's single BYO provider key's own rate limit. The module **explicitly documents its own scaling limitation**: because state lives in a single Node process's `Map`, horizontal scaling (multiple regions/instances/serverless fan-out) silently defeats the limiter entirely, with an explicit call-out that a Redis/Upstash swap would be needed beyond one instance, while noting the call-site interface wouldn't need to change.

**SSRF, injection, and input handling:** beyond the webhook SSRF guard, no SQL is hand-built from user input anywhere reviewed (all DB access goes through the Supabase JS query builder, which parameterizes automatically) — no evidence of raw SQL string interpolation from request data.

**Race-condition hardening as a security-adjacent concern**: the extensive "lost the race, re-resolve the winner" pattern for contact/conversation creation (§11/§14/§15) prevents duplicate-row proliferation, which — while framed primarily as a correctness/UX fix in the CHANGELOG — also closes off a potential resource-exhaustion vector (an attacker replaying webhook-shaped traffic, or exploiting Meta's own retry behavior, could otherwise spam-create rows before the migration-036/022 unique constraints existed).

**No documented penetration-testing or third-party security audit artifacts** were found in the repository (no `SECURITY.md` audit log beyond the vulnerability-disclosure policy file itself).

---

## 21. Environment Variables

Sourced from `.env.local.example` (the authoritative, heavily-commented reference) and cross-referenced against code.

**Required — app will not start / core paths fail without these:**
| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key (client + SSR auth) |
| `SUPABASE_SERVICE_ROLE_KEY` | RLS-bypassing key; used server-side only (webhook, engines, public-API auth path) |
| `ENCRYPTION_KEY` | 64-hex-char (32-byte) AES-256-GCM key for WhatsApp tokens + AI keys at rest |
| `META_APP_SECRET` | Verifies inbound Meta webhook HMAC signatures — without it, every webhook POST is rejected |

**Recommended:**
| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Canonical deployment URL; used for sitemap/OG images and as a fallback base for self-referential links |
| `NEXT_PUBLIC_APP_LOCALE` | Default next-intl locale (`en`) |

**Optional:**
| Variable | Purpose |
|---|---|
| `ALLOWED_INVITE_HOSTS` | Comma-separated hostname allow-list for invite-link generation; defense-in-depth against `Host`-header spoofing on bare (non-`NEXT_PUBLIC_SITE_URL`-pinned) deployments |
| `AUTOMATION_CRON_SECRET` | Shared secret protecting `GET /api/automations/cron`; required only if automations use `wait` steps |
| `META_APP_ID` | Required only for image-header template submission (Resumable Upload is app-scoped); pairs with `META_APP_SECRET` |
| `WHATSAPP_TEMPLATES_DRY_RUN` | Skips real Meta calls on template submission, for CI/local dev without a real WABA |
| `AI_REQUEST_TIMEOUT_MS` | Per-call LLM provider request timeout, default 30000ms |
| `AI_CONTEXT_MESSAGE_LIMIT` | How many recent messages are sent as context to draft/auto-reply, default 20 |

**Notably absent by design:** there is **no global/shared AI provider key** and **no global/shared WhatsApp credential** — both are exclusively per-account, user-supplied, and encrypted (the BYO-key model, §1). There is also no email-provider (SMTP/SendGrid/etc.) environment variable — team invitations are link-based, not transactional-email-based.

---

## 22. Current Strengths

- **Unusually thorough, self-documenting engineering culture.** A large fraction of non-trivial files carry extended comments explaining *why* code is shaped the way it is, frequently citing specific past production issues by number (#212, #288, #301, #363) and the exact failure mode each fix addresses. This significantly lowers onboarding friction and the risk of well-intentioned regressions.
- **Coherent, single-source-of-truth patterns for cross-cutting concerns**, deliberately reused rather than re-implemented: contact deduplication (`dedupe.ts`) is identical across webhook/manual-form/CSV-import/broadcast; the SSRF guard is identical across outbound webhooks and automation `send_webhook` steps; the RBAC ordinal ranking is identical (by design) between TypeScript and Postgres; the Meta template-send assembly is identical across manual send/broadcast/automation/flow.
- **Defense against distributed-system realities, not just happy-path logic**: explicit forward-only status-transition state machines for delivery status (§11), explicit "lost the race, re-resolve" handling for every concurrent-insert scenario, and a documented, deliberate choice of `after()` over fire-and-forget specifically because of observed serverless-freeze data loss.
- **Real, substantive security primitives**, not superficial ones: authenticated encryption (GCM, with a documented rationale over the CBC predecessor), hashed-not-plaintext storage for both API keys and invitation tokens, an SSRF guard with an honestly-documented residual gap rather than a false completeness claim, and a security-headers baseline that ships CSP in report-only mode specifically to avoid the failure mode of an untested CSP breaking production.
- **Meaningful unit test coverage of business logic** (63 test files), concentrated exactly where it matters most — the webhook-adjacent Meta API client, the automations engine, the flows engine/validator, encryption, phone normalization, dedup, and RBAC — rather than superficial coverage of trivial code.
- **A genuinely hybrid, tiered AI retrieval design** (lexical-always-works, semantic-when-configured) that gracefully degrades per-provider (Anthropic-only accounts, which have no embeddings API, aren't left broken) rather than requiring one specific provider/feature combination.
- **CI enforces lint + typecheck + test + build on every PR**, and the migration files are self-consciously idempotent, both lowering the risk of a self-hoster's deploy silently breaking.
- **The multi-tenancy migration (017) is a strong piece of engineering**: a full single-tenant-to-multi-tenant conversion executed as one coherent, backward-compatible migration with an explicit "identical behavior until a teammate is invited" invariant, rather than an incremental half-migrated state.
- **Clear separation between "what wacrm hosts" and "what the account owns"** (BYO WhatsApp token, BYO AI key, self-hosted Supabase project) is architecturally reinforced, not just a marketing claim — there's no code path where wacrm-the-vendor's own credentials are used on an account's behalf.

---

## 23. Current Limitations

- **No abstraction layer between application code and Supabase's specific query API.** Every `lib/` module and route handler calls `.from('table').select(...)` directly; there is no repository/DAO layer. This means the data-access pattern (and its authorization model, RLS vs. service-role) is tightly coupled to Supabase specifically — a future migration off Supabase (even to plain Postgres + a different auth system) would touch nearly every file in `lib/` and `app/api/`.
- **CSP is not actually enforced** (Report-Only mode only) — a real gap between the documented security posture's stated goal and its current effective state, though transparently disclosed in code comments rather than hidden.
- **The in-memory rate limiter provides no protection in any horizontally-scaled deployment.** Since state lives in a single Node process, running more than one app instance (multiple Hostinger nodes, Vercel's serverless auto-scaling, any load-balanced setup) silently and completely defeats every rate limit in the system — not degraded, *disabled* — with no runtime warning if this condition occurs.
- **Automation `wait` steps depend entirely on an externally-configured cron caller** that the self-hoster must set up themselves (documented, but easy to forget) — there is no in-process scheduler or fallback, so a misconfigured or unconfigured deployment has automations that silently never resume from a wait step, with no obvious symptom pointing at the root cause (per the sparse `# AUTOMATION_CRON_SECRET` comment, this reads as "opt-in and easy to miss" rather than "fails loudly").
- **Dashboard analytics are computed live, on every request, with no caching or materialization** — acceptable at the "low thousands of messages" scale the code comments themselves cite, but a documented-in-code ceiling nonetheless (see §25).
- **One membership per user is a hard architectural constraint**, not a current-feature gap: a person who needs to work across two separate wacrm accounts (e.g., an agency serving multiple clients, or a consultant) cannot do so with one login — they need a separate user (email) per account.
- **No transactional email integration** — invitations are link-based and must be manually distributed by the inviting admin (copy/paste into their own email or chat tool), rather than wacrm sending an invite email directly. This is a genuine feature gap relative to most SaaS CRMs, not a stylistic choice with an equivalent alternative.
- **Media proxying re-fetches from Meta on each view** (`/api/whatsapp/media/{id}` calls Meta's API to verify/resolve the URL) rather than caching or persisting media into Supabase Storage — every image/video/document view in the inbox costs a live Meta API round trip, with no documented caching layer in front of it.
- **No end-to-end/integration test suite** — only unit tests (Vitest) are present; there's no Playwright/Cypress coverage of full user flows (login → connect WhatsApp → receive message → reply), which for a webhook-and-multi-engine-fanout system like this is a meaningful gap in regression protection at the integration-boundary level, where several of the documented historical bugs (#301, #363) actually manifested.
- **Broadcast reply attribution is a heuristic, not exact**: "most recent unreplied broadcast for this contact" can misattribute a reply that has nothing to do with the actual broadcast content if a contact was recently in more than one campaign.
- **Single-locale i18n in practice**: the `next-intl` infrastructure exists and is wired throughout (`messages/en.json`), but only English is shipped — the localization framework's value isn't yet realized for actual multi-language deployments.

---

## 24. Technical Debt

- **Legacy `profiles.role TEXT` column** — explicitly called out in migration 017's own comments as "(legacy, unused) stays. Flag for removal in a later cleanup." — an acknowledged, not-yet-executed cleanup item directly in the source.
- **Dual-format encryption support (GCM + legacy CBC decrypt path)** is permanent code surface until every historical row has been touched/re-encrypted — there's an opportunistic upgrade-on-touch mechanism, but no guarantee every row has been migrated, so the legacy branch (and its slightly different security properties — unauthenticated ciphertext) may persist indefinitely for any row that's never re-saved.
- **`user_id` columns retained but repurposed** across nearly every domain table post-migration-017 (kept as an "audit/attribution" field rather than removed) — this is a reasonable trade-off, but it does mean two different UUID columns (`account_id`, `user_id`) coexist on most tables with meanings that a new engineer must learn are *not* interchangeable (a mistake here — e.g., filtering by `user_id` instead of `account_id` — would silently produce a data-isolation bug, since RLS is what actually enforces account boundaries for client-authenticated paths, but service-role code has no such backstop).
- **`message_id` (Meta's wamid) is explicitly non-unique** in the schema, by design (documented reason: ids can repeat across phone numbers) — but this means every query that resolves a message by `message_id` (status updates, reply-context lookups) must remember to scope by conversation or accept "0..N rows" semantics; a query written by someone unaware of this constraint could silently misbehave (update the wrong message, or all messages sharing that id across unrelated conversations) rather than fail loudly. The current code is careful about this everywhere reviewed, but the invariant isn't enforced by a type system or a linter rule — it's tribal knowledge in comments.
- **In-memory rate limiter and in-memory-adjacent patterns (automation `wait` cron-based resumption) are both explicitly pre-flagged in code comments as needing a swap to durable/shared infrastructure (Redis, a real queue) "if you scale beyond one instance"** — i.e., this is debt the team is already aware of and has pre-documented the exit path for, but has not yet paid down.
- **No formal schema-migration tracking table** referenced in the SQL itself — idempotency (`IF NOT EXISTS`/`DROP ... IF EXISTS`) substitutes for a proper migration-history mechanism (like Supabase CLI's `supabase_migrations.schema_migrations` or Prisma's `_prisma_migrations`). This works, but means there's no single source of truth for "which migrations has this specific database instance actually had applied" beyond re-running the full idempotent set and trusting it converges correctly — riskier than an explicit tracked-migration tool as the migration count grows (currently 36 and climbing).
- **Broadcast reply-attribution heuristic** (§13/§23) is a known-imprecise mechanism baked into the schema/trigger design rather than flagged as provisional in comments at the point of use — a candidate for a future "attribute reply to broadcast only within N hours" or conversation-context-aware refinement.
- **CSP Report-Only → Enforcing flip is an explicitly deferred TODO** embedded directly in `next.config.ts`'s comments ("once we have confidence nothing legit trips it... flip the key").

---

## 25. Scalability Concerns

- **Dashboard/analytics query layer is explicitly documented in-code as scale-bounded** ("Perf is acceptable for the current scale (low thousands of messages)... if a tenant's dataset outgrows this, we'd migrate the heavy aggregations to SQL RPCs"). Every dashboard load runs several parallel live-count/aggregate queries against the transactional tables directly; as message/conversation volume grows per account, this both slows dashboard loads and adds read load to the same tables serving the live inbox.
- **In-memory rate limiting is fundamentally single-instance.** Any horizontal scale-out (multiple app instances behind a load balancer, or serverless fan-out across concurrent invocations) makes every rate limit in the system silently ineffective simultaneously — messages sends, broadcast dispatch, the public API, and critically the AI account-wide caps whose entire purpose is protecting a shared BYO provider key from being driven past its own external rate limit by concurrent agents. At scale, this is not a gradual degradation — it's an abrupt loss of a safety mechanism the system depends on elsewhere (AI cost/rate control).
- **Automation `wait`-step resumption depends on cron-polling a table**, not an event-driven/durable-timer mechanism — as automation volume grows, the drain endpoint (`GET /api/automations/cron`) processing "due" rows in a batch on each external ping introduces both a latency floor (bounded by the pinger's own interval) and a potential throughput ceiling if a very large number of waits become due simultaneously (e.g., a broadcast-triggered automation with a uniform wait duration across thousands of recipients would create a thundering-herd of simultaneously-due pending executions).
- **Fire-and-forget automation dispatch from the webhook** means automation execution time is decoupled from webhook response time (good for Meta's timeout tolerance) but has no backpressure mechanism — a spike of inbound messages triggering many automations concurrently has no documented concurrency cap/queue, relying entirely on the Node process's and Supabase's own capacity to absorb the burst.
- **Media proxy re-verifies against Meta's API on every view** (§10/§23) — for a busy shared inbox with many agents scrolling history repeatedly, this multiplies Meta API call volume (which itself has platform-side rate limits) well beyond the number of *distinct* media items actually received, with no caching layer observed to dampen repeat views.
- **Single Postgres database, no read replica, no documented connection-pooling tuning** in the application layer — all traffic (dashboard reads, inbox reads/writes, webhook writes, automation engine reads/writes, AI knowledge-base vector/lexical search, public API traffic) contends for the same database. Supabase's managed infrastructure may provide pooling (PgBouncer) transparently, but nothing in the app code manages or tunes this itself, and there's no apparent per-workload isolation (e.g., analytics vs. transactional).
- **One-account-per-user constraint (§19/§23) is also a scale-shape concern**, not just a UX one: an agency or reseller building on top of wacrm to serve many client accounts under a unified operator login cannot do so without provisioning a separate login per client account — a structural ceiling on one plausible growth vector for the product (multi-account operators), not just a missing convenience feature.
- **No message queue anywhere in the system.** Every "background" operation (webhook processing, broadcast delivery, outbound webhook fan-out) uses Next's `after()` primitive — which keeps a single function invocation alive slightly longer, not a durable, retryable, horizontally-scalable job queue. A crashed process mid-`after()` (as opposed to a frozen one, which `after()` specifically protects against) still loses that unit of work with no automatic retry/dead-letter mechanism, as far as is observable in the code reviewed.
- **pgvector semantic search scaling is untested/undocumented at scale** — the AI knowledge base's vector column has no index-configuration detail (e.g., IVFFlat/HNSW index parameters) visible in the migration reviewed beyond `CREATE EXTENSION IF NOT EXISTS vector` and the column addition itself; large knowledge bases per account could see degraded semantic-search latency without such tuning, though this wasn't confirmed by inspecting the full migration 030 file exhaustively.

---

## 26. Recommended Improvements

*(Documented as incremental hardening/extension of the existing architecture — not a rewrite, consistent with the current design's stated philosophy and self-hosting audience.)*

1. **Externalize the rate limiter behind a pluggable interface with a Redis/Upstash-backed implementation as an opt-in**, defaulting to the current in-memory behavior for single-instance deployments (the module's own comments already state the call-site shape wouldn't need to change) — this converts a silent, scale-triggered safety-mechanism failure into an explicit deployment choice.
2. **Promote the CSP from `Report-Only` to enforcing**, per the TODO already embedded in `next.config.ts`, once the stated confidence bar (two clean deploys) is met — this is already-scoped, low-risk work per the code's own plan.
3. **Add an explicit migration-tracking mechanism** (adopt the Supabase CLI's own migration-history table, or a minimal custom `schema_migrations` table) so a given database's applied-migration state is queryable rather than inferred from idempotent re-application — reduces operational risk as the migration count continues to grow past 36.
4. **Introduce a durable, retryable job mechanism for background work currently relying solely on `after()`** (webhook post-processing, broadcast delivery, outbound webhook fan-out, automation wait-step resumption) — even a lightweight Postgres-backed job table with a proper worker loop (rather than the current wait-step-only `automation_pending_executions` + external-cron pattern) would remove the "operator must configure an external pinger correctly or automations silently break" failure mode and provide retry/dead-letter semantics that a mid-execution process crash currently lacks.
5. **Add a caching layer (even a short-TTL in-memory or Redis cache) in front of the WhatsApp media proxy route**, keyed by media id, to avoid re-verifying against Meta's API on every single inbox view of the same media item — directly reduces both latency and Meta API rate-limit pressure as inbox usage grows.
6. **Migrate the heaviest dashboard aggregations to Postgres RPCs (stored functions) or materialized views refreshed on a schedule**, exactly as the code's own comments already propose, prioritized by whichever self-hosted accounts first report slow dashboard loads — this is scoped, low-risk, and the trigger condition ("if a tenant's dataset outgrows this") is easy to detect operationally (e.g., dashboard route latency alarms).
7. **Add integration/e2e test coverage for the webhook → engines fan-out path specifically** (using a test harness that simulates Meta webhook payloads end-to-end through Flow/Automation/AI dispatch and asserts on final DB state), given that several of the most significant historical bugs (#301 dropped messages, #363 duplicate conversations) manifested exactly at this integration boundary that unit tests alone don't exercise.
8. **Formalize the `user_id` vs. `account_id` distinction with either a lint rule, a code-review checklist item, or a thin typed wrapper** that makes "this is the audit column, not the tenancy column" harder to get wrong by accident in new service-role code paths that have no RLS backstop.
9. **Schedule the already-flagged legacy cleanups** (`profiles.role TEXT` removal, eventual full migration off CBC-format encrypted rows once confirmed zero remain) as tracked follow-up work, since both are already explicitly identified in the codebase's own comments as intentionally deferred rather than overlooked.
10. **Consider a lightweight transactional-email integration (optional, not required) for invitations**, purely as a convenience layer on top of the existing link-based mechanism (which should remain the fallback for self-hosters who don't want an email-provider dependency) — closes a real feature gap relative to comparable SaaS CRMs without compromising the "no required third-party dependencies beyond Supabase + Meta" self-hosting philosophy.
