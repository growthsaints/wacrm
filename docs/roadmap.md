# Software Roadmap — Current Repository → Production-Ready SaaS

Each phase lists Features, Dependencies, Estimated Complexity, Risks, Priority, and Expected Deliverables. Phases are sequential by dependency, not strictly time-boxed — a phase begins once its dependencies are satisfied, not on a calendar.

---

## Phase 0 — Foundations & Technical Debt Paydown

**Features**
- Migration-history tracking mechanism adopted.
- In-memory rate limiter replaced with a shared/durable backend (Redis-class), interface-compatible with current call sites.
- Background job/queue infrastructure introduced (replacing `after()`-only pattern and the cron-polling wait-step mechanism).
- Legacy cleanup: remove unused `profiles.role` column; confirm/close out legacy CBC-encryption rows.
- CSP flipped from Report-Only to Enforcing.
- Integration/e2e test harness stood up for the webhook → engines fan-out path.

**Dependencies:** none (can start immediately against the current repo).

**Estimated Complexity:** Medium — mostly infrastructure substitution behind existing interfaces, not new product surface, but touches the highest-risk code path in the app (the webhook handler).

**Risks:** Regressing the carefully-hardened webhook race-condition handling while introducing the queue; underestimating how much implicit behavior depended on `after()`'s "keep the function alive" semantics.

**Priority:** Critical — every later phase's reliability assumptions depend on this foundation being solid first.

**Expected Deliverables:** A single-tenant app, functionally identical to today from a user's perspective, but running on durable job infrastructure and a shared rate limiter — ready to be multi-tenant-ized without re-litigating these foundations mid-migration.

---

## Phase 1 — Platform Schema & Multi-Tenancy Core

**Features**
- Introduce `organization` and `workspace` as first-class entities (evolution of today's single-layer `account`).
- Migrate existing accounts into the new Organization → Workspace model (one org, one workspace each, preserving current behavior exactly — mirroring how migration 017 rolled out account-sharing without breaking existing users).
- Extend RBAC: workspace-scoped roles + new `org_admin` role.
- Multi-workspace support in the UI (workspace switcher) even before multi-number exists functionally.
- Platform schema stood up (organizations, platform staff, minimal audit log) — no Super Admin UI yet, just the data layer and a bare-minimum internal tool.

**Dependencies:** Phase 0 (durable job infra needed for any large data-migration jobs; rate limiter needs to already be shared before multiplying tenants).

**Estimated Complexity:** High — this is the single largest schema/authorization change in the project's history, comparable in scope to (and building directly on) the existing account-sharing migration, but one layer deeper.

**Risks:** Data-migration correctness for existing production accounts; RLS policy regressions during the cutover (the existing `is_account_member` pattern must be re-derived carefully as `is_workspace_member`); temporary dual-write/dual-read complexity during rollout.

**Priority:** Critical — nothing else in the roadmap is buildable without this layer existing.

**Expected Deliverables:** Every existing feature works identically, now running on an organization/workspace-aware schema and RBAC model, with zero visible change to a current single-workspace customer.

---

## Phase 2 — Billing, Subscriptions & Entitlements

**Features**
- Plan catalog, subscription lifecycle, payment-provider integration (Stripe/Razorpay-class).
- Usage-metering pipeline (messages, contacts, seats, AI usage, API calls, storage) feeding entitlement checks.
- Entitlement-resolution service consulted by feature gating across UI, API rate limits, campaign sends, and AI Gateway.
- Self-serve signup → plan selection → payment flow (replacing today's "signup just creates an account" model).
- Billing settings screen (plan card, usage bars, invoices, upgrade/downgrade).

**Dependencies:** Phase 1 (billing is organization-scoped and needs the org/workspace model to exist).

**Estimated Complexity:** High — correctness-critical (money), requires careful payment-provider webhook handling, proration logic, and dunning workflows; also the first phase requiring a genuinely new service boundary (Billing Service) rather than extending existing modules.

**Risks:** Payment-provider integration edge cases (failed payments, webhook replay, proration); building an entitlement model that's flexible enough for future plan changes without becoming an unmaintainable special-case pile; getting metering accuracy wrong (over/under-billing erodes trust immediately).

**Priority:** Critical — there is no monetizable SaaS product without this phase, and every subsequent feature phase should be built plan-gated from the start rather than retrofitted later.

**Expected Deliverables:** A self-serve customer can sign up, choose a plan, pay, and operate within enforced quotas; existing/migrated customers are placed on an equivalent-to-current grandfathered plan automatically.

---

## Phase 3 — Super Admin Dashboard (Growth Saints Control Plane)

**Features**
- Full Super Admin UI: Organizations, Billing & Revenue, Feature Flags, Support & Tickets, Audit Log, System Health.
- Time-boxed, audited support-impersonation capability.
- Platform staff RBAC and management.

**Dependencies:** Phase 1 (organization data model), Phase 2 (billing data to display/manage).

**Estimated Complexity:** Medium-High — mostly a new, internally-facing UI over data that now exists, but impersonation and audit-logging correctness need care given their security sensitivity.

**Risks:** Impersonation feature becoming a security/privacy liability if not scoped and logged rigorously; scope creep (Super Admin dashboards tend to accumulate ad hoc internal tools indefinitely — needs a firm initial scope boundary).

**Priority:** High — required before onboarding a meaningful volume of self-serve customers, since there is currently no way to operate/support them at scale, but the product can technically go live to a small initial cohort without every Super Admin feature complete.

**Expected Deliverables:** Growth Saints can see, support, and operate every tenant on the platform without direct database access.

---

## Phase 4 — Multi-Number & Meta BSP Onboarding

**Features**
- Multiple WhatsApp numbers per workspace (schema + routing + Inbox number-selector UI).
- Centralized Meta Embedded Signup flow (Growth Saints as Tech Provider/BSP).
- Meta Integration Service: centralized WABA fleet management, platform-level Meta API rate-limit governance, per-number throughput-aware campaign delivery.
- WhatsApp Fleet monitoring screen (Super Admin) and per-number health indicator (Client Dashboard).

**Dependencies:** Phase 1 (numbers need workspace scoping), Phase 3 (fleet monitoring lives in Super Admin), Phase 0 (job infra needed for throughput-governed campaign delivery).

**Estimated Complexity:** Very High — this is the deepest Meta-platform integration work in the roadmap: BSP/Tech Provider certification with Meta is a business-process dependency outside engineering's direct control, and multi-number throughput governance is genuinely complex distributed-systems work (fairness across tenants and numbers simultaneously).

**Risks:** Meta's BSP approval process timeline is not fully within Growth Saints' control; getting throughput governance wrong risks WhatsApp number quality/ban issues across the whole fleet, a platform-wide risk, not a per-tenant one; self-hosters/enterprise customers who want to keep their own Meta App need a supported alternate path (not centralize-or-nothing).

**Priority:** Critical for true competitive parity (this closes the single largest Critical gap identified) but can be sequenced after Phase 3 since early customers can still be onboarded manually in the interim.

**Expected Deliverables:** A new customer can self-serve-connect a WhatsApp number through Growth Saints' own Meta App in minutes; existing large customers can alternatively bring their own Meta App; the platform actively monitors and protects number health fleet-wide.

---

## Phase 5 — Agency Layer & White Label

**Features**
- Agency-type organizations, Agency–Client links, Agency Dashboard ("Clients" section).
- White-label configuration (custom domain, branding) and its enforcement in the Client Dashboard's rendering layer.
- Agency-scoped RBAC boundary (an agency's staff can't see other agencies' or unrelated orgs' data).

**Dependencies:** Phase 1 (org model), Phase 2 (billing needs to support agency-managed or pass-through billing relationships), Phase 3 (Super Admin needs an "Agencies" view).

**Estimated Complexity:** Medium-High — mostly compositional on top of prior phases' primitives, but white-label custom-domain support (DNS/TLS provisioning per tenant domain) is a distinct piece of infrastructure work not otherwise needed elsewhere in the roadmap.

**Risks:** Custom-domain TLS provisioning at scale (thousands of potential domains) needs its own operational maturity (automated certificate issuance/renewal); getting the agency-vs-client data-boundary RLS wrong is a serious tenant-isolation risk given agencies are explicitly granted cross-org visibility by design (the one deliberate exception to strict per-org isolation).

**Priority:** High — required to compete for the reseller/agency segment AiSensy and Respond.io both serve, but not required for direct-SMB self-serve launch, so can trail Phase 4.

**Expected Deliverables:** An agency partner can onboard, manage, and white-label the product for its own client roster without Growth Saints branding being visible to end clients.

---

## Phase 6 — CRM & Channel Breadth (High-Gap Closure)

**Features**
- Full contact lifecycle model (lifecycle stages, scoring, assignment rules).
- Advanced/behavioral segmentation for campaigns.
- SLA management and escalation rules; agent performance analytics (response/resolution time, CSAT, leaderboards).
- Chatbot/Flow engine enhancements: reusable sub-flows, richer branching, flow-level analytics overlay.
- Commerce features (catalog/product messages, payment links where regionally supported).
- Additional channel(s) beyond WhatsApp (Instagram DM and/or Messenger as the first extension), sharing the unified Inbox.

**Dependencies:** Phase 1 (data model must already be multi-tenant-clean before adding this much new schema surface), Phase 0 (job infra for SLA-breach evaluation and escalation jobs).

**Estimated Complexity:** High, and best treated as several parallel sub-workstreams rather than one monolithic phase — contact lifecycle/segmentation, SLA/analytics, Flow engine enhancement, commerce, and channel expansion are largely independent of each other and can be resourced/sequenced by separate teams once Phase 1 is stable.

**Risks:** Channel expansion (Instagram/Messenger) introduces a second external-platform integration surface with its own API quirks and policy review process, analogous in kind (though smaller in scope) to the Meta WhatsApp BSP effort in Phase 4; scope is large enough that under-scoping any one sub-workstream risks shipping a shallow, non-competitive version of that feature rather than a genuine differentiator.

**Priority:** High, but internally re-prioritizable — segmentation/SLA/agent-analytics are likely higher near-term commercial value than commerce/multi-channel for most target customers and can be sequenced first within this phase.

**Expected Deliverables:** Feature parity with the High-tier gaps identified in the competitive analysis, closing the majority of the remaining distance to AiSensy/WATI/Interakt/Respond.io.

---

## Phase 7 — Public API Maturity, Integrations & Mobile App

**Features**
- Expanded public API resource model, OAuth2 support, versioning/deprecation policy, published SDK.
- Integration marketplace (pre-built connectors: Shopify, HubSpot, Zapier-class, generic webhook templates).
- Native mobile app (agent-facing inbox/contacts/notifications), push-notification delivery service.

**Dependencies:** Phase 2 (entitlements must exist for plan-gated API rate limits), Phase 6 (mobile app needs the broadened CRM/contact model to be worth shipping against), Phase 1 (multi-workspace API scoping).

**Estimated Complexity:** High — three substantial, largely independent efforts (API/SDK maturity, marketplace, mobile) bundled in one phase for sequencing purposes; each is a multi-team-month effort in its own right.

**Risks:** Mobile app introduces a new release/QA cadence and platform-review dependency (App Store/Play Store) outside the web deployment model; a public marketplace requires developer-relations and review/moderation processes, not just engineering.

**Priority:** Medium-High — valuable for retention and competitive parity (all four benchmarked competitors ship mobile apps) but not launch-blocking; reasonable to run partially in parallel with Phase 6 once Phase 2's entitlement plumbing exists.

**Expected Deliverables:** A developer ecosystem (SDK, marketplace) and an agent-facing mobile app, both built on the same public API surface as a design discipline, not bespoke backends.

---

## Phase 8 — Compliance, Trust & Enterprise Readiness

**Features**
- Data export/erasure workflows (GDPR), documented retention policies, DPA process.
- SSO (SAML/OIDC) for Enterprise-tier organizations.
- Formalized incident response, public status page, SOC2-track controls and evidence collection.
- Audit log maturity (long-retention, export, search) sufficient for enterprise procurement review.

**Dependencies:** Phase 1 (audit-log architecture), Phase 2 (billing/Enterprise-tier plan concept), Phase 3 (Super Admin compliance tooling).

**Estimated Complexity:** Medium-High — much of the technical groundwork (audit logs, RLS isolation, encryption) already exists or is built in earlier phases; this phase is largely about formalizing, documenting, and adding the remaining compliance-specific workflows (export/erasure requests, SSO) rather than net-new architecture.

**Risks:** Compliance work is easy to under-scope because much of it is process/documentation, not code — but enterprise sales cycles will stall without it, so the business risk of deprioritizing this phase is disproportionate to its engineering size.

**Priority:** Medium for an SMB-first launch strategy, but should be re-prioritized to High/Critical if the go-to-market plan targets enterprise customers earlier — sequencing here is a business-strategy decision, not a technical dependency, once Phases 1–3 are in place.

**Expected Deliverables:** The platform is credibly sellable into enterprise procurement processes, with the trust/compliance posture to match Respond.io's and WATI's Enterprise-tier offerings.

---

## Phase 9 — Continuous: Analytics/Reporting Depth, Template Library, Polish

**Features**
- Materialized-view/analytics-schema read layer maturity as data volume grows (directly addressing the documented dashboard-scaling ceiling).
- Template gallery/library, campaign A/B testing, richer custom-field types, contact merge tooling, notification-preference center, multi-language UI rollout.
- Ongoing Medium/Low gap closure from the competitive analysis, prioritized by customer feedback rather than a fixed technical sequence.

**Dependencies:** Phase 1 (analytics schema needs the multi-tenant model finalized), otherwise largely independent, incremental work layered onto a stable platform.

**Estimated Complexity:** Low-Medium per individual feature; this phase is structured as an ongoing backlog rather than a single scoped effort, explicitly because these are the Medium/Low-priority competitive gaps that shouldn't block or dilute focus on the Critical/High phases above.

**Risks:** Primary risk is prioritization discipline — without care, "polish" work can absorb engineering capacity that should stay focused on Phases 4–8's larger gaps; should be resourced as a smaller, continuous stream rather than blocking any major-phase team.

**Priority:** Low-to-Medium, continuous — never "done," intentionally never gates a major release.

**Expected Deliverables:** Steady, incremental closing of the remaining competitive gap surface and scaling-headroom improvements, run as an ongoing product-quality workstream alongside whichever major phase is current.

---

## Sequencing Summary

```
Phase 0 (Foundations)
   → Phase 1 (Multi-Tenancy Core)         [Critical, blocking]
        → Phase 2 (Billing)               [Critical, blocking]
             → Phase 3 (Super Admin)      [High]
             → Phase 4 (Multi-Number/BSP) [Critical for parity]
             → Phase 5 (Agency/White Label)[High]
             → Phase 6 (CRM/Channel Breadth)[High, parallelizable sub-tracks]
                  → Phase 7 (API/Marketplace/Mobile) [Medium-High]
        → Phase 8 (Compliance/Enterprise) [Medium→re-prioritizable to Critical]
   → Phase 9 (Continuous polish)          [Low-Medium, ongoing throughout]
```

Phases 3, 4, and 5 can be resourced partially in parallel once Phase 2 lands, given separate engineering ownership per the service boundaries defined in the architecture document — the strict sequencing above reflects hard dependencies, not a mandate that only one phase runs at a time.
