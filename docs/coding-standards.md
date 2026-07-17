# Coding Standards

Codifies patterns already proven in the current codebase as mandatory team-wide rules for the SaaS rebuild, plus new rules required by the larger team and multi-tenant scope. No code samples — principles and rules only.

---

## 1. Tenancy Discipline (non-negotiable)

- Every new table that holds tenant data must carry `workspace_id` (and `organization_id` where applicable per the database doc). No exceptions without explicit architecture review.
- Every service-role (RLS-bypassing) code path must explicitly filter by `workspace_id`/`organization_id` on every query — this is treated as a security-critical review checklist item on every PR touching a background worker, webhook handler, or platform-schema code, not an optional convention.
- Platform-schema and tenant-schema code must never share a database client instance/helper that could make cross-schema access accidental rather than deliberate.

## 2. Authorization Pattern

- One shared predicate function per authorization axis (workspace membership, organization admin, platform staff role) — never inline, ad hoc role-string comparisons in a route handler or RLS policy. Any new capability check is added to the shared predicate module, mirrored on both the TypeScript and Postgres sides, exactly as the current `roles.ts` / `is_account_member()` pairing establishes.
- Route handlers resolve authorization in the fixed order: authenticate → resolve tenancy scope → resolve role → resolve plan entitlement. No handler skips a step because "it's probably fine."

## 3. Background Work

- Nothing latency-sensitive-but-not-required-for-the-HTTP-response is done inline; it goes through the job queue. `after()` (or equivalent) is reserved for work that genuinely must complete before considering the request done, not as a substitute for a real queue.
- Every job handler is idempotent — safe to run twice on retry. This generalizes the existing Flow-engine `meta_message_id` idempotency pattern into a platform-wide rule.
- Every job handler must be individually observable (success/failure/duration recorded) — feeding the Super Admin System Health screen is not optional instrumentation, it's a requirement of "done."

## 4. Error Handling & Logging

- Dispatch/fan-out functions that other code calls fire-and-forget (automation triggers, webhook delivery) must never throw — this existing rule from `runAutomationsForTrigger` becomes a documented, linted convention for any function annotated/named as a "dispatcher."
- Distinguish "not configured" from "misconfigured" in return values wherever both are possible (the existing `loadAiConfig` pattern: `null` vs. thrown error) — silently treating a broken credential the same as an absent one is a standards violation, not a style preference.
- Structured logging (not bare `console.log`) is required once the platform has a real log aggregation pipeline — every log line includes `workspace_id`/`organization_id` and a correlation/request id so a support engineer can trace one tenant's issue without grepping global logs.

## 5. Database Migrations

- Every migration remains idempotent (existing standard, kept).
- Every migration is registered in the migration-history tracking mechanism (new requirement per Phase 0 of the roadmap) — no migration ships without an entry that lets any environment answer "has this been applied here."
- Every migration that touches an RLS policy requires an explicit before/after policy-behavior note in its header comment, mirroring the existing style already used in migration 017 — this is the single most valuable documentation pattern in the current codebase and is made mandatory going forward.
- Data-repair migrations (like the conversation-dedup migration) must be reviewable independently of the schema change they accompany — the repair logic and the constraint it enables are two distinct pieces of risk and should be called out as such in the migration's own comments.

## 6. Testing

- Every `lib/` module with business logic ships with a co-located unit test, unchanged from current practice.
- Every new engine/worker (automation, flow, AI, campaign delivery, webhook delivery) requires integration-level test coverage exercising it through the queue, not just unit tests of its pure logic — closing the gap identified in the current-state analysis where the historically-buggiest code (the webhook fan-out path) had only unit coverage.
- Multi-tenant isolation gets its own dedicated test category: for every new table/endpoint, a test asserting that Tenant A cannot read/write Tenant B's data through any code path (RLS and service-role-scoped-query paths both) — this is a standards requirement specific to the SaaS rebuild, not present as a formal category in the current single-tenant test suite.

## 7. API Design

- Public API changes follow the versioning/deprecation policy in `docs/api.md` — no silent breaking changes, ever.
- Every public API endpoint declares its required scope explicitly and is covered by the same `requireApiKey`-style single-entry-point authorization helper — no bespoke auth logic per route.
- Internal and public API route handlers stay thin; business logic lives in `lib/`, unchanged from current practice — this separation is what made the current codebase's `lib/` layer testable and reusable across dashboard/API/engines, and remains a first-order design rule.

## 8. Frontend/UI Consistency

- Shared UI primitives (the WhatsApp device-frame preview, the segment/filter builder, the status-badge/color vocabulary) are implemented once and reused everywhere they appear, per the UI design document — a second, slightly-different implementation of any of these is treated as a standards violation requiring consolidation, not an acceptable local optimization.
- Role/entitlement-gated UI elements use the shared `useCan`/entitlement-hook pattern, never a component-local role string check.

## 9. Secrets & Encryption

- Any new class of sensitive credential (payment-provider keys, SSO certificates, platform-pooled AI keys) is encrypted at rest using the existing AES-256-GCM primitive and key-rotation-aware dual-format decrypt pattern — this is the established, reasoned-through approach and is not to be reinvented per feature.
- No sensitive credential is ever logged, including in error messages — code review checklist item.

## 10. Documentation-as-Code

- Every non-obvious design decision is documented inline at the point of implementation, in the style already established by the current codebase (explaining *why*, referencing the specific bug/issue that motivated a defensive pattern where applicable) — this is treated as equally mandatory as the code itself, not optional polish, because it is the single biggest factor in the current repository's own onboarding-friendliness.
