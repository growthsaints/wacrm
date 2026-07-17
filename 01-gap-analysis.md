# wacrm → Production SaaS: Competitive Gap Analysis

Benchmarked against: **AiSensy, WATI, Interakt, Respond.io**
Method: capability comparison only — no implementation guidance. Each gap is something the current single-tenant, self-hosted-template codebase does not have today.

---

## CRITICAL — blocks any SaaS launch

| Gap | Why it's critical |
|---|---|
| **No multi-tenancy at the platform level** (current "account" model is self-hosted-per-install, not a hosted platform serving thousands of businesses from one deployment) | Every competitor is a hosted multi-tenant platform. This is the foundational gap everything else depends on. |
| **No billing/subscription system** (no plans, no metering, no payment provider integration, no invoicing) | SaaS cannot monetize without this. All four competitors have tiered pricing (contacts/conversations/agents-based). |
| **No usage metering** (messages sent, conversations opened, contacts stored, API calls, AI tokens) tied to a plan/quota | Required for plan enforcement, overage billing, and fair-use limits. |
| **No super-admin / platform-operator control plane** (an operator cannot see, manage, suspend, or support tenants across the platform) | Currently every deployment is its own island; there is no way to operate this as a company managing many customers. |
| **No plan-based feature gating / entitlements engine** | Competitors differentiate Starter/Pro/Enterprise by feature access (AI, automations, API, seats). Nothing in the current RBAC model expresses "plan," only "account role." |
| **Single WhatsApp number per account, hard constraint** (`whatsapp_config UNIQUE(account_id)`) | All four competitors support multiple WhatsApp Business numbers per client (multi-brand, multi-region, multi-department). This is a hard schema-level blocker today. |
| **No official WhatsApp Business Solution Provider (BSP) / Tech Provider onboarding flow** (Embedded Signup, WABA provisioning at scale, number migration, quality-rating handling across thousands of tenants) | Competitors are Meta-verified BSPs/Tech Providers; the current app expects each self-hoster to bring their own Meta App and WABA manually — this does not scale to onboarding thousands of businesses in minutes. |
| **No centralized rate limiting / quota system that survives horizontal scale** (current limiter is in-process memory) | A hosted multi-tenant platform runs multiple instances; the existing limiter silently does nothing at that point, including the guardrails protecting BYO AI keys and Meta send limits. |
| **No background job / queue infrastructure** (`after()` only) | Broadcast sends to large lists, automation waits, webhook retries, and AI batch operations all need durable, retryable execution at platform scale — not "keep the function alive a bit longer." |
| **No audit logging** (who did what, when, across an account or across the platform) | Required for enterprise trust, compliance (SOC2-track), support/dispute resolution, and is standard in WATI/Respond.io Enterprise tiers. |
| **No data residency / compliance posture** (GDPR data processing agreements, data export/erasure workflows, no documented retention policy) | Enterprise buyers (the segment Respond.io and WATI compete hardest for) require this contractually. |

---

## HIGH — required for credible competitive parity

| Gap | Why it matters |
|---|---|
| **Multiple WhatsApp numbers per tenant, with per-number routing, teams, and permissions** | AiSensy/WATI/Interakt/Respond.io all support this for agencies and multi-location businesses. |
| **Agency / reseller layer** (one operator managing many client sub-accounts, white-labeled) | AiSensy and Respond.io both have partner/agency programs; this is a distinct tenancy layer above "account." |
| **White-labeling** (custom domain, custom branding, custom sender identity, removable "Powered by") | Standard on WATI and AiSensy's partner/agency plans. |
| **Self-serve onboarding** (signup → plan selection → payment → WhatsApp connection wizard, no manual operator involvement) | Current signup creates an account but has no plan/payment step and no guided embedded WhatsApp signup. |
| **In-app WhatsApp number quality/health monitoring** (messaging tier, quality rating, ban-risk warnings) surfaced to the client | WATI and Interakt both surface this prominently; currently only template-level status is tracked. |
| **CRM-grade contact lifecycle** (lead status, lifecycle stages, contact scoring, ownership/assignment rules beyond conversation-level) | Respond.io and HubSpot-adjacent competitors treat contacts as full CRM records, not just chat participants. |
| **Advanced segmentation / dynamic lists** for campaigns (beyond tag + custom-field filter) — behavioral, RFM-style, engagement-based segments | AiSensy and Interakt market this as a core campaign differentiator. |
| **Multi-channel inbox** (WhatsApp + Instagram DM + Facebook Messenger + email + SMS in one inbox) | Respond.io's core positioning is omnichannel; Interakt and AiSensy have added Instagram/FB. wacrm is WhatsApp-only. |
| **Chatbot/flow builder parity features**: NLP intent matching, variables/attributes across flows, A/B branching on message content, reusable sub-flows/snippets | Current Flow engine is button/list-menu-driven only — no NLU, no reusable flow components. |
| **Team performance / agent productivity analytics** (first response time SLA, resolution time, CSAT, per-agent leaderboards) | Standard reporting module across all four competitors; current dashboard has response-time charts but no SLA/CSAT/agent scorecards. |
| **SLA management & escalation rules** | Respond.io and WATI both offer configurable SLAs with breach alerts/escalation. |
| **Public status page / uptime transparency** | Expected of any SaaS platform serving paying customers. |
| **In-app support/ticketing for tenants** (help widget, ticket history) | Standard SaaS expectation; nothing exists today beyond GitHub issues (a self-host template pattern, not a SaaS support model). |
| **Native mobile app** (agent app for iOS/Android to handle inbox on the go) | WATI, Interakt, AiSensy, and Respond.io all ship mobile apps; none exists here (web-only). |
| **Payment/commerce integration** (WhatsApp catalog, cart, payment links, order tracking) | AiSensy and Interakt both push commerce-on-WhatsApp features; nothing in current schema addresses this. |
| **CSAT / feedback collection built into conversations** | Standard in Respond.io/Interakt post-resolution flows. |
| **Broadcast throughput at scale** (rate-limited, tiered sending across large recipient lists, per-number Meta throughput management, automatic failover between numbers) | Current broadcast delivery is a straightforward loop; no throughput governor tuned to Meta's per-number messaging limits, no multi-number load distribution. |
| **Data import/export at scale** (bulk contact import beyond CSV, migration tooling from other platforms) | Competitors offer migration assistance/tools for switching customers. |
| **Two-way CRM/ecommerce integrations** (Shopify, WooCommerce, HubSpot, Zapier/Make, native webhooks marketplace) | AiSensy and Interakt both integrate deeply with ecommerce platforms; wacrm has generic outbound webhooks only, no pre-built connectors. |

---

## MEDIUM — competitive polish, expected but not launch-blocking

| Gap | Why it matters |
|---|---|
| **Template library / gallery** (pre-approved, industry-specific starter templates) | AiSensy and Interakt both ship template galleries to speed up onboarding. |
| **Bulk template variable personalization from CSV/Sheet upload** beyond current per-recipient JSON variables | Convenience feature competitors highlight. |
| **Chatbot analytics** (drop-off per node, conversion funnel through a flow) | Respond.io has flow-level analytics; wacrm's Flow engine has no analytics layer. |
| **Role-based dashboard customization / saved views** | Common in Respond.io/HubSpot-class tools. |
| **Contact merge/de-duplication UI** (manual merge tool beyond phone-based auto-dedup) | Present in most CRM-grade competitors as a data-hygiene feature. |
| **Notification center with granular per-channel preferences** (email digest, Slack/Teams alert integration, push) | Currently in-app notifications only. |
| **Multi-language support in the product UI itself** (i18n infra exists but only English is shipped) | Global competitors ship localized UIs. |
| **Sandbox / test WhatsApp number for trial users** | AiSensy and Interakt provide sandbox numbers so trial signups can test before connecting their own WABA. |
| **In-app changelog / product-update notifications** | Standard SaaS retention/engagement pattern. |
| **Custom fields with richer types** (multi-select, relation-to-another-object, computed fields) | Current custom fields are simple typed key/value; competitors offer richer field modeling. |
| **Broadcast A/B testing** (template/content variants with automatic winner selection) | Interakt/AiSensy campaign feature. |
| **Public API rate-limit tiers by plan**, API usage dashboard for tenants | Exists structurally (per-key limit) but not tied to plan or surfaced as a usage dashboard to the client. |
| **Marketplace/App directory** for third-party integrations | Respond.io has a public app marketplace; nothing equivalent here. |

---

## LOW — nice-to-have, differentiators/edge polish

| Gap | Why it matters |
|---|---|
| **AI-powered conversation summarization for handoff** beyond the current short internal note | Polish feature some competitors are adding. |
| **Voice message transcription** in the inbox | Present in some competitor roadmaps, not core. |
| **Custom emoji / branded reaction sets** | Cosmetic. |
| **Dark mode parity across every screen** (partially present via theme system) | Polish. |
| **In-product NPS/CSAT survey builder for the tenant's own customers** beyond simple post-chat rating | Nice-to-have layered on CSAT gap above. |
| **AI-generated campaign copy suggestions** | Marketing-productivity nice-to-have some competitors offer. |
| **Public developer changelog / API versioning portal** | Polish for a mature public API. |
| **Gamification of agent performance** (badges, streaks) | Rare, low-priority differentiator seen in a couple of competitor roadmaps. |

---

### Summary framing
The current repository is a well-engineered **single-tenant WhatsApp CRM template**. To be comparable to AiSensy/WATI/Interakt/Respond.io as a **hosted SaaS product**, the Critical and High gaps are not incremental features — they represent a second tenancy layer (platform → agency → account), a commerce layer (billing/metering/entitlements), an operational layer (super-admin control plane, audit, background jobs at scale), and a channel/CRM breadth layer (multi-number, multi-channel, full contact lifecycle) that do not exist in any form today.
