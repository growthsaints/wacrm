# UI Architecture — Premium Enterprise CRM Redesign

Reference bar: HubSpot (information density done cleanly), Interakt/Respond.io (WhatsApp-CRM UX patterns), Freshchat (inbox ergonomics), Slack (navigation/workspace-switching feel), Linear (speed, keyboard-first interaction, restrained visual language). UI architecture only — layout, hierarchy, interaction model, and design system principles. No code.

---

## 1. Design System Foundations

- **Visual language:** Linear-inspired restraint — generous whitespace, a single accent color used sparingly (status/action only, never decoration), neutral gray scale doing most of the work, subtle elevation (soft shadows, not heavy borders) for layering. Typography: one typeface family, a tight scale (5–6 sizes), medium weight for structure instead of bold-everywhere.
- **Density modes:** "Comfortable" and "Compact" as a user-level preference (HubSpot/Linear pattern) — compact mode matters most in Inbox and Contacts table views where agents live all day.
- **Color system:** neutral base + one brand accent + semantic colors (success/warning/danger/info) reused consistently for status everywhere (message delivery states, subscription status, WABA health, SLA breach) so color always means the same thing platform-wide.
- **Iconography:** one consistent icon set (line-style, consistent stroke width) — status, module, and action icons all drawn from the same family so the eye doesn't context-switch.
- **Motion:** minimal, functional only (panel slide-ins, optimistic-state micro-transitions on send) — never decorative animation, in keeping with the Linear reference.
- **Command palette (⌘K)** — a Linear-pattern global command bar available everywhere in both dashboards: jump to any conversation/contact/campaign, run quick actions ("create broadcast," "invite teammate"), switch workspace. This is a structural navigation *alternative* to clicking through the sidebar, not a gimmick — power users (agents handling high volume) should rarely need the mouse.

---

## 2. Global Application Shell (Client Dashboard)

Three-pane persistent shell, consistent across every module:

- **Far-left rail (icon-only, Slack-pattern):** workspace switcher at top (avatar/logo stack, click to switch or add a workspace), then module icons (Dashboard, Inbox, Contacts, Campaigns, Automation, AI, Templates, Analytics), with Settings and the user's own avatar/menu pinned at the bottom. Always visible, never collapses — this is the primary wayfinding anchor.
- **Secondary sidebar (contextual, module-specific):** appears next to the icon rail and changes per module — e.g., in Inbox this is the conversation list; in Contacts, saved views/segments; in Campaigns, campaign folders/status filters; in Settings, the settings section list. This is the HubSpot/Linear "list + detail" pattern applied consistently.
- **Main content pane:** the actual working surface — conversation thread, contact detail, campaign builder, etc.
- **Optional right-hand contextual panel** (collapsible): contact details while in a conversation, AI suggestions/draft panel, or flow-node configuration — appears only when relevant, never permanently reserved space.
- **Top bar (thin, persistent):** breadcrumb/current-context title, global search trigger, notification bell, command-palette hint, and (new, SaaS-specific) a **plan/usage indicator chip** (e.g., "1,240/2,000 conversations this month") that's always quietly visible, not just buried in Settings — this is a deliberate self-serve billing-transparency pattern.

---

## 3. Screen: Dashboard (Home)

- **Header row:** workspace name + date-range selector + a "what needs attention today" summary strip (SLA breaches, AI handoffs waiting, failed campaign sends) — surfaced *above* the metrics, because in a busy inbox-first product the most valuable dashboard real estate is "what's on fire," not vanity metrics.
- **Metric card row:** open conversations, unresolved SLA breaches, messages today, active campaigns — each card click-through drills into the relevant module pre-filtered, not just a static number (Linear's "everything is a link" philosophy).
- **Two-column body:** left column — conversation volume trend + response-time distribution (existing charts, restyled); right column — team activity feed (assignments, resolutions, campaign completions) as a live-updating timeline, and a compact agent-presence roster.
- **Bottom band:** pipeline value donut + top campaign performance snapshot — secondary information, intentionally below the fold priority.
- **Empty/new-workspace state:** a guided setup checklist (connect WhatsApp number → invite team → import contacts → create first automation) replaces the dashboard entirely for a brand-new workspace — onboarding-as-the-first-screen, not a blank dashboard with zero data.

---

## 4. Screen: Inbox

The highest-frequency screen; Freshchat/Slack ergonomics are the primary reference.

- **Conversation list (secondary sidebar):** grouped by status tabs (Open / Pending / Closed / Mine / Unassigned) as a segmented control at the top, not a dropdown — one click to switch context, Linear-pattern. Each row: contact avatar/name, last message preview, relative timestamp, unread indicator, assigned-agent avatar, and small inline badges (AI-handled, SLA-at-risk, has-open-deal). Dense, scannable, no wasted vertical space — this list is read hundreds of times a day.
- **Filter/sort bar** above the list: by tag, by assigned agent, by number (multi-number workspaces), by SLA state — persisted per-user as a saved view, selectable from a small dropdown (HubSpot "saved views" pattern).
- **Thread pane (main content):** message bubbles with clear sender differentiation (customer left, agent/AI right, distinct subtle color for AI-generated with the existing "✨ AI" badge), interactive-message rendering (buttons/lists shown as they appeared to the customer), reply-quoting, reactions, and a **thin SLA/session-window countdown strip** pinned just above the composer (new — makes the 24-hour template-required window and any SLA timer visually explicit rather than a silent constraint the agent has to know from memory).
- **Composer:** persistent bottom bar — text input, attachment, quick-reply picker, template picker (auto-surfaces automatically when outside the 24h window instead of the agent discovering the error after send), voice-note record, and the AI draft (✨) trigger. AI draft appears as an inline suggestion chip above the composer the agent can accept/edit/discard, not a modal — keeps the agent in flow.
- **Right contextual panel:** contact summary (key fields, tags, custom fields, deal value if in a pipeline), conversation actions (assign, change status, add note), and — when AI has handled the thread — the "Take over / Resume AI" banner surfaced here rather than inline in the message list, so it doesn't interrupt reading history.
- **Multi-number affordance:** when a workspace has more than one connected number, a small number-selector chip sits in the conversation-list header so agents can filter/focus by number — critical new UI surface not needed in the single-number product today.
- **Keyboard-first interactions:** `j`/`k` to move between conversations, `⌘Enter` to send, `/` to trigger quick-reply search — Linear/Slack-pattern power-user affordances layered on top of the mouse-driven UI, not a replacement for it.

---

## 5. Screen: Contacts

- **List view (default):** dense data table (HubSpot pattern) with configurable columns, inline sort, and a persistent left-edge saved-segments rail (All Contacts, tag-based segments, lifecycle-stage segments, "Created this week," custom saved filters).
- **Segment builder:** a filter-condition builder (AND/OR groups) opened from a "New Segment" action — visually a stacked condition-row builder, consistent with the Automation condition-step UI so the same mental model is reused across the product.
- **Bulk action bar:** appears contextually when rows are selected (tag, add to campaign, export, merge, assign) — standard data-table pattern, currently absent from the product.
- **Contact detail (drawer, not full page navigation):** opens as a right-side drawer over the list rather than a full page transition, so an agent can rapidly page through contacts without losing list context — timeline of activity (messages, deal changes, tag changes, notes) as the dominant panel, with a compact fields/tags summary pinned at top.
- **Import flow:** a dedicated multi-step wizard (upload → field mapping → dedupe preview showing what will merge vs. create → confirm) — the dedupe-preview step is new relative to today's import and directly surfaces the existing backend dedup logic to the user instead of it being invisible.
- **Merge tool:** side-by-side field comparison UI when merging two contact records, letting the user pick which value wins per field — currently no UI for this exists.

---

## 6. Screen: Campaigns (Broadcasts)

- **Campaign list (secondary sidebar → main list):** status-grouped (Draft / Scheduled / Sending / Sent / Failed) similar pattern to Inbox's segmented tabs, with each row showing a compact delivery funnel (sent → delivered → read → replied) as an inline mini-bar rather than raw numbers only.
- **Campaign builder — reframed as a single-page guided flow with a persistent step rail on the left** (Template → Audience → Personalize → Review & Schedule), rather than a hard multi-page wizard — allows jumping back to an earlier step without losing later-step state, addressing a common wizard-UX complaint.
- **Audience step:** visually reuses the Contacts segment builder component (design-system consistency — the same filter-condition UI appears in both places) plus a live audience-size counter that updates as filters change.
- **Personalize step:** template preview rendered exactly as WhatsApp will show it (device-frame mock), with variable fields mapped inline next to the preview rather than in a separate form — what-you-see-is-what-you-send.
- **Review & Schedule step:** a final summary card (recipient count, estimated send duration given number throughput, cost/quota impact against plan) before confirming — the "estimated send duration" and "quota impact" elements are new, directly surfacing the platform's throughput-governance and billing-metering concerns to the user at the moment of decision.
- **Live-sending view:** once dispatched, the campaign detail becomes a real-time progress view (sent/delivered/read/failed counters ticking up), not a static page requiring manual refresh.

---

## 7. Screen: Automation (Rule Engine + Flow Builder, Unified)

- **Landing view:** a single "Automation" module with two clearly labeled creation paths presented as cards — "Quick Rule" (trigger → conditions → actions, the existing rule engine) and "Visual Flow" (the canvas-based bot builder) — unified list view below showing both types together with a type badge, rather than two separate disconnected sections as implied by today's separate routes.
- **Rule builder:** vertical step list (Trigger card → Condition cards → Action cards), each card expandable inline for configuration — avoids modal-stacking, keeps the whole automation visible as a readable "recipe" top to bottom.
- **Flow builder (canvas):** kept as the React-Flow-style visual canvas (already strong in the current product), enhanced with: a left component palette (drag-in node types), a right inline config panel for the selected node (replacing any modal-based node editing), and a **validation panel** (already exists) elevated to a persistent bottom strip showing unresolved issues live as the user edits, not just on save.
- **New: Flow analytics overlay** — a toggle on the canvas that overlays live drop-off counts on each node/edge (how many contacts reached this node, how many proceeded) directly on the diagram — addresses the identified "no flow-level analytics" gap with a visualization-native solution rather than a separate report.
- **Templates gallery:** a "Start from template" entry point (industry-common flows: order confirmation, appointment reminder, FAQ bot) presented as a card grid before the blank canvas — reduces blank-page cold-start.

---

## 8. Screen: AI Agents

- **Setup tab:** provider/model selection, key entry (BYO) or "Use platform AI" toggle (new, plan-gated), system prompt/persona editor with a live preview pane on the right showing how the agent would respond to a sample message as you type the prompt — instant feedback instead of save-then-test.
- **Knowledge Base tab:** document list (title, last updated, indexing status: lexical-only vs. semantic-enabled shown as a small badge), add/edit in a side drawer, and a prominent "Reindex" status indicator when an embeddings key is newly added.
- **Playground tab:** kept as a dedicated test-chat surface, restyled to look like an actual WhatsApp conversation preview (device-frame) so what's tested visually matches production, plus a visible "would hand off here" marker inline when the model's response indicates handoff.
- **Usage tab:** token-spend chart (existing) plus, new, a cost-attribution breakdown by mode (draft vs. auto-reply) and — for platform-pooled AI — a clear "included in your plan" vs. "overage" split, tying AI usage directly into the billing-transparency pattern established on the global top bar.

---

## 9. Screen: Templates

- **Gallery + Library tabs:** "My Templates" (existing, table with status badges: Draft/Pending/Approved/Rejected, color-coded consistently with the platform's semantic-color system) and a new "Template Library" tab — pre-built, industry-categorized starter templates a user can clone and customize, addressing the identified template-gallery gap.
- **Editor:** WhatsApp device-frame live preview beside the form (header/body/footer/buttons), consistent with the campaign personalize-step preview pattern — one preview component reused everywhere a template is shown, per design-system discipline.
- **Submission status detail:** clicking a Pending/Rejected template opens a drawer showing Meta's actual rejection reason (surfaced clearly, not just a status word) and a "fix and resubmit" action.

---

## 10. Screen: Analytics

- **Report picker (secondary sidebar):** Overview, Team Performance (SLA/CSAT/agent leaderboard — new), Campaign Performance, Contact Growth, AI Performance, Custom Reports.
- **Team Performance report (new screen):** an agent leaderboard table (response time, resolution time, conversations handled, CSAT score) plus a per-agent drill-in, and an SLA-breach timeline — directly answers the identified "no agent productivity analytics" gap.
- **Every report:** consistent date-range control, export action (CSV/PDF), and a "schedule this report" action (email digest — new, ties into the notification-preferences gap) in the same top-right position across all report screens, per the design system's consistency discipline.

---

## 11. Screen: Settings

Restructured as a categorized settings hub (not a flat list), mirroring the mature-SaaS pattern (Slack/Linear settings):

- **Workspace** — name, timezone, business hours, connected WhatsApp number(s) with per-number health status inline (quality rating, messaging tier — surfaced directly rather than buried).
- **Team & Roles** — member list, role badges, invite management — visually upgraded with role-permission tooltips explaining exactly what each role can do inline (reduces support tickets asking "what can an agent do").
- **Billing & Plan** *(new)* — current plan card, usage-vs-limit bars for every metered resource (messages, contacts, seats, AI usage, API calls), upgrade/downgrade action, invoice history, payment method management.
- **API Keys** — existing key management, enhanced with a per-key usage sparkline.
- **Integrations** *(new)* — connector marketplace entry point (Shopify, HubSpot, Zapier, generic webhooks) as a card grid.
- **White Label** *(agency-tier only)* — logo, custom domain, color theme, "powered by" toggle, live preview of the branded login screen.
- **Appearance** — theme (existing).
- **Security** — sessions, password (existing), plus SSO configuration for Enterprise-tier orgs (new entry, feature-gated).

---

## 12. Agency Dashboard (a mode within the Client Dashboard, agency-tier orgs only)

Not a third separate dashboard — an additional top-level nav item ("Clients") that appears only for Agency-type organizations, structurally similar to the Super Admin's "Organizations" screen but scoped to the agency's own roster:

- **Client roster table:** client org name, plan, seats used, WhatsApp number health at-a-glance, last-active date, quick-action menu (impersonate-for-support with audit trail, suspend, message).
- **Add Client flow:** a guided creation wizard (create client org → assign plan/seats → send onboarding invite) run by the agency, mirroring the platform's own onboarding but scoped to what an agency is allowed to configure.
- **Agency branding preview:** a persistent card showing exactly what the client currently sees under white-label (logo/domain/colors), with a one-click "preview as client" mode.
- **Revenue/commission summary** (if the platform supports agency billing pass-through): a simple rollup, not a full financial system — detailed billing stays in the Super Admin dashboard.

---

## 13. Super Admin Dashboard — UI Design

Deliberately **visually distinct** from the Client Dashboard (different chrome, a "you are in platform-operator mode" persistent indicator — e.g., a colored top strip) so Growth Saints staff can never mistake which context they're in, especially during impersonation sessions.

- **Shell:** left rail with platform-scope modules (Overview, Organizations, Agencies, Billing & Revenue, WhatsApp Fleet, AI Usage & Cost, Feature Flags, Support, Audit Log, System Health, Staff, Compliance) — denser, more table-driven, less "product marketing polish" than the client side, in keeping with an internal operations-tool aesthetic (function over delight, but still consistent with the same base design system for legibility).
- **Organizations screen:** the primary workhorse — a dense, filterable/sortable table (plan, MRR, status, health score, last activity) with saved views (e.g., "At risk," "Trial expiring this week"), and a detail drawer per org showing usage, billing, support history, and — gated behind a confirmation + reason-code prompt — the impersonation entry point.
- **WhatsApp Fleet screen:** a table/grid of every number across the platform with color-coded quality-rating badges (reusing the same semantic-color system as everywhere else), filterable by "at risk" status, and a drill-in showing that number's owning org and recent send volume.
- **System Health screen:** operational dashboard style (queue depths, job failure rates, third-party dependency status lights) — the one screen that intentionally looks more like an infrastructure-monitoring tool than a CRM, because that's its job.
- **Audit Log screen:** a searchable, filterable, append-only event stream (actor, action, target, timestamp) with no edit/delete affordances anywhere in the UI, reinforcing immutability visually as well as technically.

---

## 14. Cross-Cutting UI Patterns

- **One preview component** (WhatsApp device-frame) reused across Templates, Campaigns, Flow "send message" nodes, and AI Playground — never re-implemented differently per screen.
- **One filter/segment-builder component** reused across Contacts, Campaigns audience step, and Analytics custom reports.
- **One status-badge/color vocabulary** used identically for message delivery status, template status, subscription status, WABA health, and SLA state — a user who learns the color system once understands it everywhere.
- **Drawers over modals for detail views** (contact detail, org detail, template detail) so users retain list context; **modals reserved strictly for confirmations and short single-field inputs**.
- **Empty states are always actionable**, never a bare "no data" — every empty state in every module includes the specific next action to take (matches the Dashboard's guided-checklist pattern, applied consistently).
- **Plan/usage awareness is ambient, not hidden** — the top-bar usage chip, in-context quota warnings on the campaign review step, and the Billing settings page are three visible surfaces of one underlying entitlement system, so self-serve customers always understand their standing without hunting for it.
