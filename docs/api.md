# API Layer — Design (Platform + Public + Internal)

No code — structural API design only.

---

## 1. Three API Surfaces

1. **Internal Dashboard API** — session-authenticated, consumed only by the Client Dashboard and Super Admin Dashboard web apps. Not versioned as strictly as the public API (can evolve alongside the UI), but still organized by module (mirrors the architecture doc's module list).
2. **Public REST API (`/v1`)** — API-key authenticated, the current model's design extended: every capability the mobile app, MCP server, and third-party integrations need must exist here. This is the platform's actual product surface for developers/partners and must be treated with public-API discipline: formal versioning, a deprecation policy, and a published reference (already partially true via `docs/public-api.md` today).
3. **Platform API** — a separate, internal-only surface used exclusively by the Super Admin Dashboard and by Growth Saints' own internal tooling (billing reconciliation scripts, support tooling) to operate on platform-schema data (organizations, subscriptions, fleet). Never exposed to tenants, not even via API key — authenticated only via platform-staff session, mirroring the strict separation established in the architecture and database docs.

---

## 2. Public API — Expanded Resource Model

Beyond today's `contacts`, `conversations`, `messages`, `broadcasts`, `webhooks`, `me`, production SaaS parity requires:

- **Workspaces & Numbers** — list the caller's accessible workspaces/numbers (a multi-workspace organization's key needs to know what it can act on).
- **Templates** — read template status; submit is likely kept dashboard-only initially given Meta's approval-flow complexity, but read access is needed by any integration that composes template sends.
- **Automations/Flows** — read-only listing at minimum (mirrors what the MCP server's read-first, opt-in-write model already assumes); write access as a later, carefully scoped addition.
- **Tags & Custom Fields** — CRUD, needed by any serious CRM-sync integration (e.g., a Shopify connector tagging contacts by purchase behavior).
- **Usage & Entitlements** — a `me`-adjacent endpoint exposing the calling key's organization's current plan/usage snapshot, so third-party integrations and the mobile app can self-adjust behavior near quota limits rather than only discovering a hard failure.
- **AI** — a scoped `ai:draft` capability allowing an external system to request a draft reply, useful for custom integrations building their own agent UI on top of wacrm's AI (subject to plan gating).

---

## 3. Authentication & Authorization — Extended Model

- **API keys remain hashed, scope-based**, now workspace-scoped by default with an org-admin-only organization-wide key option (per database doc §9).
- **Scope catalog grows** in lockstep with the resource model above (`workspaces:read`, `templates:read`, `automations:read`, `tags:write`, `usage:read`, `ai:draft`, etc.) — the existing `hasScope` single-predicate pattern is preserved as the enforcement mechanism, just with a larger scope catalog.
- **OAuth2 (new)** — for the future integration marketplace and any partner-built app acting on behalf of a user interactively (rather than a long-lived static key pasted into settings), a proper OAuth2 authorization-code flow is needed as a second authentication mode alongside static API keys — static keys remain appropriate for server-to-server/automation use (Zapier, custom scripts), OAuth is appropriate for a marketplace app a user explicitly authorizes.
- **Rate limiting tied to plan tier**, not a flat global number — the current single `publicApi: 120/min` bucket becomes plan-differentiated (e.g., higher ceilings on higher tiers), read from the same entitlement-resolution mechanism the database doc describes (§11 of database.md), so rate limiting and billing entitlements are never two separately-maintained sources of truth.

---

## 4. Versioning & Compatibility

- **URL-path versioning continues** (`/v1`, future `/v2`) as the current pattern already establishes — kept for simplicity and precedent.
- **A formal deprecation policy** (minimum notice period, sunset headers on responses, a published changelog) is a new requirement once external third parties and a mobile app depend on this surface — today's single-repo template context doesn't need this discipline, but a SaaS platform with paying API consumers does.
- **Backward-compatible additive changes** (new optional fields, new endpoints) don't require a version bump; breaking changes (removed/renamed fields, changed semantics) require a new version and a deprecation window for the old one.

---

## 5. Error Model & Envelope

The existing consistent JSON error envelope (`unauthorized`/`forbidden`/`rate_limited` helpers) is preserved as a design principle and extended with a **stable machine-readable error-code catalog** (not just HTTP status codes) so SDK/integration authors can branch on specific conditions (e.g., `quota_exceeded` vs. generic `403`) — necessary once third parties build durable integrations against this API rather than just the first-party dashboard.

---

## 6. Webhooks (Outbound) — Extended Event Catalog

Today's `conversation.created`, `message.received`, `message.status_updated` extend to cover the new SaaS surface: `campaign.completed`, `template.status_changed`, `subscription.updated` (for organizations that want to react to their own plan/billing changes programmatically), `automation.triggered`. The existing signing (`lib/webhooks/sign.ts`) and SSRF-guarded delivery pattern is preserved unchanged as sound design — extended only in event catalog breadth and, at scale, delivery durability (see Deployment doc's background-jobs section) so outbound delivery survives a worker restart rather than being a single in-request attempt.

---

## 7. SDKs & Developer Experience

Not present today; a production SaaS with a public API and a marketplace ambition needs: an official TypeScript/Node SDK (thin wrapper generated from or hand-aligned to the API reference) as the first priority (matches the mobile app and integration-builder audience most directly), a Postman/OpenAPI-spec published reference (the existing `docs/public-api.md` becomes the source for a generated spec rather than hand-maintained prose only), and sandbox/test-mode API keys that operate against a non-billed, clearly-labeled test workspace — mirroring the existing `WHATSAPP_TEMPLATES_DRY_RUN` philosophy but extended platform-wide for API testing.

---

## 8. Internal Dashboard API — Design Notes

Kept intentionally less formal than the public surface (it's allowed to evolve alongside the UI without a versioning contract), but must still respect the same underlying authorization discipline: every internal route handler resolves session → organization/workspace membership → role → entitlement, in that order, exactly mirroring the public API's resolution chain conceptually even though the authentication mechanism differs — this consistency is what prevents the internal and public surfaces from silently diverging on "what counts as allowed."

---

## 9. Platform API — Design Notes

Every endpoint requires a platform-staff role check *and*, for anything reading/mutating a specific organization's data (support impersonation, plan overrides), writes an entry to the platform audit log as a side effect of the request itself — audit logging is not optional/best-effort here, it is a structural part of what "an authorized platform API call" means, consistent with the database doc's immutable-audit design.
