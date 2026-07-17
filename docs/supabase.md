# Supabase — Platform Usage Design

No code — design only. Documents how Supabase's specific capabilities are used across the redesigned platform, extending the current single-tenant usage into SaaS scale.

---

## 1. Role in the Architecture

Supabase remains the platform's Postgres + Auth + Storage + Realtime provider — the redesign does not propose moving off Supabase, but does propose using more of its capability surface deliberately (schemas, read replicas, partitioning-friendly table design) rather than the single-schema, single-instance usage of today.

## 2. Auth

- **Tenant users** continue to authenticate via Supabase Auth, unchanged in mechanism (email/password today; SSO/SAML-OIDC added for Enterprise-tier orgs in roadmap Phase 8 as an Auth-provider-level extension, not a parallel identity system).
- **Platform staff** also use Supabase Auth, but in a deliberately separate identity space (distinct table/trust boundary, per the database doc) — never the same underlying user record wearing both a tenant and a platform-staff "hat" via a role flag, closing off a class of privilege-escalation risk by construction.
- **Session refresh correctness** (the existing, carefully-fixed middleware cookie-rotation logic) is preserved unchanged as a proven pattern — this is exactly the kind of subtle SSR-auth behavior that should not be casually touched during the platform rebuild.

## 3. Row Level Security

- RLS remains the primary authorization enforcement layer for anything reachable via the anon/authenticated client key — extended, not replaced, per the database doc's schema-separation and shared-predicate-function design.
- Service-role (RLS-bypassing) usage grows substantially with the number of background workers and platform services introduced by the redesign — this is an accepted, necessary trade-off (workers have no `auth.uid()` to key RLS off), formally documented as a standing engineering discipline in the coding-standards doc rather than left implicit.

## 4. Realtime

- Postgres CDC-based Realtime subscriptions remain the live-update mechanism for the Inbox and presence — extended to be explicitly `workspace_id`-scoped in both publication configuration and any channel-authorization logic, so a multi-tenant Realtime channel can never leak cross-tenant row changes (a risk that doesn't meaningfully exist in the current single-tenant-per-install deployment model but must be actively designed for once one Supabase project serves many tenants).
- Future mobile app reuses this same Realtime mechanism rather than requiring a separate real-time protocol, per the architecture doc.

## 5. Storage

- Bucket structure remains tenant-path-scoped (evolving today's per-user-folder pattern to per-workspace), with bucket-level RLS policies mirroring the same database-side authorization predicates — one consistent authorization model regardless of whether the resource is a row or a file.
- Storage lifecycle/tiering (hot/cold, per the database doc) is implemented using whatever combination of Supabase Storage capabilities and, if needed, an external object-storage tier for archival cold data are most cost-effective at the platform's actual data volume — flagged as an implementation decision to revisit once real usage data exists, not fixed in this design.

## 6. Database Scaling Levers

- **Schemas** (`platform`, `tenant`, `billing`, `audit`, `analytics`) as the primary organizational tool, per the database doc — a Supabase/Postgres-native capability the current single-schema design doesn't yet use.
- **Read replicas** as the mechanism behind the `analytics` schema's materialized-view refresh source, decoupling reporting query load from the transactional Inbox/webhook write path — planned for from the start even if not provisioned at day-one traffic levels.
- **Time-based partitioning** on the highest-volume tables (Messages, Broadcast Recipients, Audit logs), a standard Postgres capability, applied per the database doc's scale design.
- **Connection pooling** (Supabase's managed PgBouncer-class pooling) becomes an actively-monitored capacity concern once dozens of independently-scaled services (Web/App, Public API, multiple worker pools) all hold connections to the same database — a non-concern in the current single-process deployment model, an explicit operational parameter to size and monitor at SaaS scale.

## 7. Migrations

- The current idempotent-SQL-file pattern is retained as a safety property, paired with a formal migration-history tracking mechanism (Phase 0 of the roadmap) — using either Supabase CLI's own migration tooling or an equivalent tracked-migrations approach, so that "which migrations has this environment actually had applied" is a queryable fact, not an inference from re-running an idempotent script and trusting it converges.

## 8. Extensions

- `pgvector` (already in use for the AI knowledge base) is retained, with explicit index-configuration as a scale requirement (per the database and AI docs) rather than default settings.
- `uuid-ossp`/`pgcrypto`-class extensions for identifier generation remain in use, unchanged in kind from current usage.

## 9. Multi-Project Consideration (Future, Not Day-One)

- The architecture's workspace-scoped design does not preclude, for a small number of very large enterprise customers with strict data-residency or isolation requirements, provisioning a dedicated Supabase project/database for that tenant later — flagged as an available future lever (consistent with the architecture doc's own note on this), not a day-one requirement, since the vast majority of the target "thousands of businesses" customer base is well-served by the shared, RLS-isolated, schema-separated single-project design described above.
