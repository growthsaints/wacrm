    # AI Subsystem — Platform Design

No code — design only. Extends the current BYO-key draft/auto-reply/RAG system into a platform-scale, dual-cost-model AI layer.

---

## 1. Two Cost Models, One Gateway

- **BYO key** (current model, preserved): an account's own OpenAI/Anthropic key, encrypted at rest, zero AI spend flows through Growth Saints — retained specifically for privacy-sensitive and enterprise customers, and as a zero-marginal-cost option for the platform.
- **Platform-pooled AI** (new): Growth Saints holds provider keys, meters usage per organization against plan entitlements, and bills overage — the default, frictionless option for self-serve SMB customers.
- Both paths route through a single **AI Gateway** service so metering, rate limiting, provider failover, and audit logging are implemented once, not duplicated per cost model.

## 2. Scope of the AI Gateway

- Per-organization/workspace rate limiting (replacing today's in-process-only buckets), tied to plan entitlement, not a flat global number.
- Token-usage metering feeding both the existing per-workspace Usage dashboard and the organization-level billing rollup — one write path, two read consumers.
- Provider failover/circuit-breaking (if a provider is degraded, requests can fail over to an alternate model/provider where the account's plan and configuration allow it) — a platform-level reliability concern that doesn't exist in the current single-account BYO model.
- Prompt/response audit logging (metadata and, where policy allows, content) for the Playground, for abuse detection, and for support debugging — scoped and access-controlled distinctly from customer conversation data.

## 3. Consumption Modes (unchanged in kind, extended in scale)

- **Draft** — agent-triggered, in-flow suggestion in the Inbox composer.
- **Auto-reply** — automated, bounded by per-conversation cap and account-wide rate limit (existing pattern), now also bounded by plan-tier quota.
- **Handoff** — unchanged mechanism (route to human, leave a summary note), extended with a workspace-level "handoff routing" concept once multi-number/multi-team workspaces exist (which number/team's queue does a handoff land in).

## 4. Knowledge Base / RAG

- Hybrid retrieval (lexical always-on, semantic when an embeddings key/plan entitlement is present) is preserved as sound design.
- **Workspace-scoped by default**, with an optional **organization-level shared knowledge base** tier for multi-workspace organizations wanting common grounding content across brands/numbers.
- Vector index tuning becomes an explicit operational responsibility at SaaS scale (thousands of tenants' knowledge bases), not a default-configuration afterthought.
- Reindexing and ingestion move onto the job-queue infrastructure (Phase 0) rather than running inline, so large knowledge-base uploads don't block the request path.

## 5. Governance & Cost Control

- Super Admin "AI Usage & Cost" screen: platform-pooled spend vs. revenue, per-organization anomaly detection (disproportionate usage relative to plan), provider-level outage/rate-limit monitoring across the whole tenant base — none of this exists in the current single-tenant design and is a direct requirement of offering platform-pooled AI as a paid feature.
- Feature-flag-gated model/provider rollout: new models or providers can be enabled for a subset of organizations (beta cohort) before platform-wide rollout, using the same entitlement-override mechanism the database doc describes.

## 6. Playground & Testing

- Preserved as-is in capability (test the exact production code path pre-activation), restyled in the UI redesign to a WhatsApp-device-frame preview — no functional change to the "test before you enable" principle, which is a genuine current strength.

## 7. Data Handling & Trust

- Customer conversation content sent to a BYO-key provider is unchanged from today (goes directly from Growth Saints' infrastructure to the customer's own provider account, under their own provider terms).
- Content sent through platform-pooled AI is subject to Growth Saints' own data-processing terms with its chosen provider(s), and must be clearly disclosed to the customer (a Settings-level disclosure, and part of the DPA/compliance workstream in the roadmap's Phase 8) — this distinction is a trust-relevant product decision, not just a technical detail, and both paths should remain available so customers can choose based on their own data-sensitivity requirements.
