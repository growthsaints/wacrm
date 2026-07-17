# Meta Platform Integration — Design

No code — design only. Covers Growth Saints' relationship with Meta as a platform, distinct from the WhatsApp Cloud API technical detail (see `docs/whatsapp.md`).

---

## 1. From "Self-Hosted App" to "Tech Provider / BSP"

Today, each self-hosted deployment brings its own Meta App (`META_APP_ID`/`META_APP_SECRET`) and manually configures its own WABA. At SaaS scale this does not work for a self-serve, thousands-of-businesses platform. Growth Saints must operate as a **Meta Tech Provider / Business Solution Provider**, meaning:

- One (or a small number of, for isolation/limit-management reasons) Meta App(s) owned and operated by Growth Saints, used to onboard every customer's WhatsApp number via Embedded Signup, rather than each customer configuring their own Meta developer account.
- A formal relationship with Meta (partner/BSP status) that carries its own approval process, ongoing policy-compliance obligations, and platform-level rate limits that must be actively managed across the entire tenant base — this is a business/legal dependency as much as a technical one and should be tracked as such in planning (see roadmap Phase 4 risk notes).

## 2. Embedded Signup Flow

- A guided, in-product flow (Settings → Workspace → Connect WhatsApp Number) where the customer authorizes Growth Saints' Meta App to act on behalf of their own Facebook Business/WABA — the customer retains ownership of their WABA and number; Growth Saints' App is granted operational access, not ownership.
- Replaces the current model's implicit assumption that the *self-hoster* configures Meta App credentials directly — under the SaaS model, `META_APP_ID`/`META_APP_SECRET`-equivalent credentials become **platform-level secrets** (see Deployment doc §6), never customer-facing.
- An **alternate "bring your own Meta App" path** remains available for enterprise customers with compliance requirements that preclude centralization — this keeps the current self-hosted-template's flexibility available as an option within the SaaS product, not eliminated by it.

## 3. WABA / Number Fleet Management

- Every connected number's quality rating, messaging tier, and any Meta-side restriction/flag is tracked centrally by the Meta Integration Service and surfaced both to the owning customer (Settings, per-number health) and to Growth Saints operationally (Super Admin WhatsApp Fleet screen).
- Number provisioning, migration (moving a number between WABAs, e.g., a customer switching in from another provider), and deprovisioning (customer offboarding) are handled as first-class, monitored workflows — currently implicit/manual, this becomes an explicit operational capability at scale.

## 4. Platform-Level Rate Limit & Throughput Governance

- Meta enforces limits at multiple levels: per-number messaging tier/throughput, and App/Business-level API call limits. With thousands of tenants sharing Growth Saints' Meta App(s), the platform must actively load-balance and fairly allocate against these shared limits — a concern that does not exist in the current one-app-per-self-hoster model, where each deployment only ever contends with itself.
- Campaign delivery, template submission, and any bulk operation against Meta's API must be governed by this centralized throughput-management logic, not sent as fast as each tenant's own code happens to loop through recipients (today's simpler, single-tenant-appropriate pattern).

## 5. Template Submission at Scale

- Thousands of tenants submitting templates concurrently requires a queued, rate-governed submission pipeline to Meta (via the job-queue infrastructure), replacing a synchronous per-request submission call, plus a fleet-wide monitoring view for stuck/rejected submissions (feeding the Super Admin dashboard).

## 6. Policy Compliance & Risk Management

- As a BSP, Growth Saints is accountable to Meta for policy compliance across its entire tenant base, not just its own conduct — this motivates the Trust & Safety platform-staff role (able to suspend/flag a tenant's number for policy violations) and the WhatsApp Fleet health-monitoring capability, both of which are new organizational/product requirements introduced specifically by taking on BSP responsibility.
- A tenant-facing acceptable-use policy specific to WhatsApp messaging (opt-in requirements, prohibited content categories, spam-complaint handling) becomes a contractual and product requirement, surfaced at minimum in onboarding and Settings, and enforced operationally through the Trust & Safety tooling.
