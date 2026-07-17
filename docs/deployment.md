# Deployment Architecture

No code — infrastructure/operational design only.

---

## 1. Deployment Topology

- **Web/App Service and Public API Service** deploy as horizontally-scaled, stateless instances behind a load balancer — any of the current single-VPS or serverless-platform targets remain viable, but the SaaS platform's deployment must assume **multiple concurrent instances** as the normal case, not an edge case (directly why Phase 0's shared rate limiter and job queue are prerequisites, not nice-to-haves).
- **Webhook Ingestion Service** deploys separately from the main app, sized and scaled independently — it has a distinct traffic profile (bursty, latency-sensitive, must never be slow to acknowledge Meta) and must not compete for capacity with dashboard traffic or the Public API.
- **Engine Workers** (automation, flow, AI, campaign delivery, webhook delivery, notification delivery) each deploy as independently-scalable worker pools consuming from the job queue — sized per workload characteristics (AI workers need provider-latency-aware concurrency limits; campaign delivery workers need Meta-throughput-aware concurrency limits).
- **Billing Service** and **Meta Integration Service** deploy as smaller, carefully-monitored services given their correctness-criticality — favor fewer, well-observed instances over aggressive auto-scaling that could complicate reasoning about billing consistency or Meta API rate-limit accounting.
- **Environments:** at minimum `production`, `staging` (a full-fidelity pre-production environment, including its own Meta test app / sandbox WABA and test payment-provider credentials), and ephemeral per-PR preview environments for the dashboard UI — the current single-environment-implied setup (CI runs against dummy env vars only) is extended with a real staging environment as a Phase 0/1 requirement once multiple engineers are shipping concurrently against shared infrastructure.

## 2. CI/CD

- Existing CI discipline (lint → typecheck → test → build on every PR) is preserved and extended with: multi-tenant isolation test suite (per coding-standards doc) as a required gate, migration-history validation (a PR introducing a migration must register it correctly) as a required gate, and a staging deploy + smoke test step before any production promotion.
- **Database migrations run as a distinct, gated pipeline step**, separate from application deployment — never bundled into "just part of the app boot," so a migration can be reviewed, staged, and rolled back independently of application code releases, especially important once migrations may include long-running operations (partitioning, large backfills) at SaaS data volumes.
- **Feature flags gate incomplete/risky features in production** (reusing the Feature Flags/Entitlement Overrides platform-schema entity for internal dogfooding and gradual rollout, not just customer-facing plan differentiation) — reduces the risk of any single large-phase rollout (e.g., multi-number support) being an all-or-nothing production cutover.

## 3. Observability

- **Structured logging with tenant/correlation context** (per coding-standards §4) feeding a centralized log aggregation/search system — not present today (console logging only), required once support and on-call need to trace a specific tenant's issue across services.
- **Metrics and dashboards** for: job queue depth/latency/failure rate per job type, Meta API call volume and error rate per number/per platform-App-level limit, AI provider call latency/error rate/cost per provider, database query latency percentiles on the hot Inbox/webhook path specifically (separated from Analytics-schema query latency, which is expected to be slower and is not a paging-alert concern) — these feed directly into the Super Admin System Health screen described in the architecture/UI docs, and into on-call alerting.
- **Distributed tracing** across the webhook ingestion → engine dispatch → outbound send path, given how many independent services that single logical operation now touches — necessary to debug the kind of subtle cross-service timing issue that, in the current single-process design, was debuggable via careful code reading alone (as the documented history of issues #301/#363 shows) but will not be once that logic is split across independently-deployed services.
- **Alerting tied to both technical and business signals**: standard infra alerts (error rate, latency, queue backlog) plus business-signal alerts (a WhatsApp number's quality rating dropping, a spike in failed payments, an organization approaching/exceeding its plan quota) — the latter category doesn't exist today and is a direct requirement of operating a paid, quota-enforced platform.

## 4. Data Backup, Recovery & Retention

- **Point-in-time recovery** on the primary database is a baseline requirement (typically a managed-Postgres/Supabase capability) — formally documented as an operational requirement rather than assumed.
- **Tiered retention/archival** (hot/cold storage per the database doc) is itself a backup/retention *policy* decision as much as a cost-optimization one — archived-but-not-deleted data must remain recoverable within the plan's stated retention window, a contractual/product commitment that operations must be able to honor.
- **Disaster recovery runbook**: documented recovery-time and recovery-point objectives per service tier (Billing and Meta Integration Services warrant tighter RPO/RTO than, say, the Analytics read layer, which can tolerate being stale/rebuilt) — not present as a formal artifact today, required once the platform carries paying customers' operational data at stake.

## 5. Multi-Region Considerations

- Not required at initial SaaS launch, but the service-boundary design (architecture doc §5) deliberately avoids anything that would preclude a future move to regional deployment (e.g., for EU data-residency commitments to enterprise customers) — the Web/App, Public API, and stateless worker services are the easiest to make regional first; the database and Billing Service are the hardest and would be the last to regionalize, consistent with how most SaaS platforms sequence this when the need arises (flagged here as a future consideration, not a Phase 0–9 roadmap item, since no current competitive gap analysis finding requires it at launch).

## 6. Secrets Management

- Environment-variable-based secrets (current pattern) are replaced with a proper secrets-management service (vault-class) once the number of services/environments/engineers grows past what hand-managed `.env` files can safely support — particularly for the encryption master key, payment-provider keys, and platform-pooled AI provider keys, all of which warrant access-audited, rotatable storage rather than static deployment-platform environment variables.
