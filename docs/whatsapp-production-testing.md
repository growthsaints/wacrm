# WhatsApp Embedded Signup — production testing readiness

Everything required to test Milestone 1 (Super Admin platform) and
Milestone 2 (official Meta Embedded Signup) against a **real** Meta
Business account. This is a readiness/testing reference, not user
documentation — it belongs alongside the code it describes.

## 1. What's already built (for context — no gaps here)

- **Milestone 1**: `platform_admins` + RLS (`037_platform_admin.sql`),
  Super Admin dashboard (`/platform`), organization suspend/reinstate,
  "Login as Client" impersonation, workspace switcher.
- **Milestone 2**: official Facebook Login for Business Embedded
  Signup (`/api/whatsapp/embedded-signup/complete`), cached Meta
  metadata (`038_whatsapp_embedded_signup.sql`), WhatsApp Management
  panel, Super Admin "WhatsApp Numbers" page. The legacy manual
  connection form still works unchanged, under Settings → WhatsApp →
  Advanced setup.

Nothing below is a code change to that feature set — this is entirely
external configuration + a step-by-step test plan.

## 2. Environment variables

All of these are already read by the code and documented in
`.env.local.example`; this table is the "what do I actually need to
set, and why" cross-reference for a real test pass.

| Variable | Required for | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Everything | From Supabase project settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Everything | From Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Milestone 1 + 2 | Powers `platformAdminClient()`, `whatsappAdminClient()`, the webhook handler. **Never** expose to the client. |
| `ENCRYPTION_KEY` | Milestone 2 | 64-char hex. Encrypts the token Embedded Signup exchanges, exactly like the manual flow. |
| `META_APP_ID` | Milestone 2 (server) | Used server-side for the code→token exchange and resumable template uploads. |
| `META_APP_SECRET` | Milestone 2 (server) | Used server-side for the code→token exchange and inbound webhook HMAC verification. |
| `NEXT_PUBLIC_META_APP_ID` | Milestone 2 (client) | **Same value as `META_APP_ID`.** Inlined into the browser bundle to init the Facebook JS SDK. |
| `NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID` | Milestone 2 (client) | The Facebook Login for Business "Configuration ID" (§3 below). |
| `META_WEBHOOK_VERIFY_TOKEN` | Milestone 2 | One shared token for the central Meta App's webhook subscription (§4 below). Must match Meta's dashboard exactly. |
| `PLATFORM_ADMIN_BOOTSTRAP_EMAILS` | Milestone 1 | Comma-separated email(s) that become a platform admin on first login. **Set this to your own email before testing `/platform`** — there is no other way to seat the first admin. |

⚠️ **`NEXT_PUBLIC_*` vars are inlined at `next build` time**, not read
at runtime. If you set/change `NEXT_PUBLIC_META_APP_ID` or
`NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID` after a build, you must rebuild
— restarting the server alone will keep serving the old (or missing)
value baked into the JS bundle. This is the single most common reason
"Continue with Facebook" appears disabled/unconfigured in a deployed
environment even though the env var looks correct in the panel.

## 3. Required Meta App settings

One Meta App, owned by Growth Saints (the "Tech Provider" app every
tenant connects through — tenants never create their own Meta App).

1. **Create the app** at [developers.facebook.com](https://developers.facebook.com) as a **Business** type app, associated with your Business Manager.
2. **Add products**: `WhatsApp` and `Facebook Login for Business`.
3. **Create a Facebook Login for Business Configuration** (Facebook Login for Business → Configurations → Create configuration → choose **WhatsApp Embedded Signup** as the use case). This yields the `config_id` for `NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID`. Request permissions:
   - `whatsapp_business_management` — **required**
   - `whatsapp_business_messaging` — **required**
   - `business_management` — **recommended, not required**. Without it, `getBusinessDetails()` fails permission checks and the code falls back to the WABA's own name (`getWabaDetails()`) — connection still succeeds, just with a slightly less friendly "Business Name" on the Management panel.
4. **App Domains** (Settings → Basic): add the production domain the CRM is served from. The Embedded Signup popup will not load correctly from a domain not listed here.
5. **App mode — Development vs Live**: Development mode only works for the app's own test businesses/admins. To onboard a real, unrelated client business, the app must be in **Live** mode, which requires:
   - **App Review** approval for `whatsapp_business_management` and `whatsapp_business_messaging` (submit a screen-recording of the Embedded Signup flow — standard Meta requirement for these permissions).
   - **Business Verification** on the owning Business Manager (§5 below) — Meta will not approve these permissions for Live mode without it.
6. **HTTPS + a real domain for testing the popup**: the Embedded Signup popup will not behave correctly against plain `http://localhost`. Use a staging domain or an HTTPS tunnel (ngrok or similar) for any test that needs the actual Facebook popup, not just unit tests.

## 4. Required webhook settings

Configured **once**, in the Meta App dashboard (WhatsApp → Configuration → Webhook) — not per tenant. Every Embedded-Signup-connected organization shares this one subscription; this is what `META_WEBHOOK_VERIFY_TOKEN` is for.

- **Callback URL**: `https://<your-domain>/api/whatsapp/webhook`
- **Verify token**: exactly the value of `META_WEBHOOK_VERIFY_TOKEN`
- **Subscribed fields** — toggle on:
  - `messages` — **required**. Inbound messages/status updates; without this, nothing arrives regardless of how well Embedded Signup completed.
  - `message_template_status_update`, `message_template_quality_update`, `message_template_components_update` — **recommended**. These are actively handled (`src/lib/whatsapp/template-webhook.ts`) but not required — without them, template status/quality changes only show up after clicking "Sync templates" manually.

Self-hosters still using the legacy manual flow with their **own** Meta App are unaffected — that path keeps using its existing per-account `verify_token` field, checked by the same webhook route's fallback loop.

## 5. Required Business Verification

This is an external, human-driven Meta process — nothing in this repo automates or shortcuts it.

- The Business Manager that owns the Growth Saints Tech Provider app must complete **Business Verification** (Meta Business Suite → Security Center → Start verification): legal business name, address, phone, and a registration document (varies by country). Meta's review can take from hours to several days.
- Verification is a prerequisite for: the app going **Live**, higher **messaging tiers**, and generally for onboarding client businesses that aren't already test users on the app.
- **For an initial internal/sandbox test pass**, this can be deferred: keep the app in Development mode and add the specific test business/number as a **test user** or **tester** under App Roles — the full Embedded Signup → register → subscribe → sync pipeline can be exercised end-to-end without Business Verification, just not with an arbitrary unrelated client business yet.

## 6. Required Supabase configuration

- **Apply every migration in order**, through `038_whatsapp_embedded_signup.sql` (36 pre-existing + `037_platform_admin.sql` + `038_whatsapp_embedded_signup.sql`). Both are additive/idempotent — safe against a database that already has 001–036 applied.
- **Authentication → Providers → Email** must be enabled (already required for ordinary sign-in; Milestone 1's impersonation additionally relies on the Admin API's `generateLink`/`verifyOtp` for the same Email provider — no separate toggle needed beyond this).
- **Service role key** copied into `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API).
- No new extensions are required for Milestones 1–2 specifically (`uuid-ossp` from migration 001 is the only dependency either touches).

## 7. Required production configuration

- Rebuild after setting/changing any `NEXT_PUBLIC_*` variable (§2).
- Serve over **HTTPS** — required by Meta for both the webhook callback and the Embedded Signup popup.
- If you enforce a stricter CSP later (`next.config.ts` currently ships `Content-Security-Policy-Report-Only`), the allow-list already includes `https://connect.facebook.net` (script) and `https://www.facebook.com` (connect) for the Embedded Signup SDK — verify these survive if the CSP list is edited again before flipping it to enforced.
- Confirm the deployed domain matches what's registered in the Meta App's **App Domains** (§3.4) — a mismatch silently breaks the popup with a Facebook-side domain error, not an error from this codebase.
- Set `PLATFORM_ADMIN_BOOTSTRAP_EMAILS` to the real operator's email *before* their first login in the production project.

---

## 8. End-to-end testing checklist

### 8.1 Environment sanity (do this first)
- [ ] All variables in §2 are set in the deployed environment
- [ ] A fresh `next build` has run since the last `NEXT_PUBLIC_*` change
- [ ] Migrations through `038` applied to the target Supabase project
- [ ] Meta App: WhatsApp + Facebook Login for Business products added, Embedded Signup configuration created, webhook callback + verify token saved (§4)
- [ ] Test business/number added as a tester if the app is still in Development mode (§5)

### 8.2 Platform admin bootstrap (Milestone 1)
- [ ] Sign up / sign in as the email listed in `PLATFORM_ADMIN_BOOTSTRAP_EMAILS`
- [ ] Visit `/platform` — access granted, no redirect to `/dashboard`
- [ ] Sidebar of the regular tenant dashboard now shows a **Super Admin** link
- [ ] Settings → Platform admins shows this user; add a second admin by email, then remove it (not yourself — last-admin guard should block self-removal down to zero)

### 8.3 Organizations + impersonation (Milestone 1)
- [ ] `/platform/organizations` lists every tenant, search works
- [ ] Open an organization's detail page — members, usage counts, WhatsApp status all render
- [ ] **Suspend** the organization → confirm a member of that org is now blocked from the dashboard (any API call returns "This account has been suspended")
- [ ] **Reinstate** → confirm access returns immediately
- [ ] **Login as client** → confirm you land in that org's `/dashboard` as its owner, the "Viewing as X" banner appears
- [ ] **Return to admin** from the banner → confirm you're back as the platform admin, and the org's owner session is not left active in your browser
- [ ] Workspace switcher in the Super Admin nav jumps directly to another org's detail page

### 8.4 Embedded Signup — happy path, new number (Milestone 2)
- [ ] As a tenant admin, open Settings → WhatsApp — Management panel shown, **no technical fields visible**
- [ ] Click **Continue with Facebook** → Facebook login popup opens
- [ ] Complete: log in → select Business Manager → select/create a WhatsApp Business Account → select or create a phone number → grant permissions
- [ ] Popup closes; CRM shows a success toast and the Management panel populates: Business Name, Display Name, Phone Number, Connection Status = connected, Quality Rating, Messaging Limit, Verified Status, Last Sync = just now
- [ ] Send a real WhatsApp message to the connected number from an external phone — confirm it lands in the Inbox (proves `/register` + `/subscribed_apps` + the webhook fast-path all actually worked)
- [ ] Reply from the Inbox — confirm it's delivered
- [ ] Templates approved on that WABA appear under Settings → Templates without clicking Sync manually (proves the automatic post-signup sync ran)

### 8.5 Management actions (Milestone 2)
- [ ] **Refresh status** → Last Sync timestamp updates, quality/messaging-limit fields refresh
- [ ] **Sync templates** → toast reports a template count, table updates
- [ ] **Disconnect** → confirmation dialog, then Management panel returns to the empty "Connect WhatsApp" state; inbound messages to that number stop being processed by this tenant
- [ ] **Reconnect** (re-run Embedded Signup for the same number) → succeeds, overwrites the prior config cleanly

### 8.6 Error handling (Milestone 2)
- [ ] Close the Facebook popup manually mid-flow → CRM shows a cancelled state, no partial/broken config left behind
- [ ] Deny a requested permission in the popup → clear, non-technical error message
- [ ] Attempt to connect a phone number already connected to a **different** organization on this instance → 409-style "already connected to another organization" message, nothing overwritten
- [ ] (If testable) an existing number that already has its own 2FA PIN set outside Growth Saints → connection is saved but flagged "action needed" with a message pointing at Advanced setup's PIN field (documented limitation, §9)
- [ ] Simulate a Meta API failure (e.g., temporarily revoke the app's permission, or test during a known Meta outage window) → clear error surfaced, nothing crashes

### 8.7 Super Admin visibility (Milestone 1 + 2 together)
- [ ] `/platform/whatsapp` lists the number connected in §8.4, correct organization name, health = Healthy, onboarding method = Embedded Signup
- [ ] Suspend the owning org (§8.3) → number still visible to the Super Admin with correct status (data isn't hidden by suspension)

### 8.8 Backward compatibility (must not regress)
- [ ] An existing manually-connected number (pre-Milestone-2) still shows correctly under Settings → WhatsApp → Advanced setup, still sends/receives normally
- [ ] Its "Test API Connection" / "Reset Configuration" / "Verify Registration" buttons still work exactly as before
- [ ] A self-hoster with **no** `META_APP_ID`/`NEXT_PUBLIC_META_APP_ID`/`NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID` set sees a clear "not configured" message in place of the Connect button and can still use the manual form with zero errors

## 9. Known limitations carried into this test pass

- An existing number migrated in with a 2FA PIN set outside Growth Saints will reject the auto-generated PIN Embedded Signup uses for brand-new numbers — recovery is the existing manual PIN field, not a fully zero-touch path for that one case.
- Business Verification (§5) and Meta App Review are external, human-reviewed processes with no code-side shortcut — plan calendar time before a client-facing pilot, not just before this test pass.
- One WhatsApp number per organization remains the existing invariant; multi-number-per-tenant is out of scope.
- The in-memory rate limiter (pre-existing, `src/lib/rate-limit.ts`) is per-process — fine for this test pass on a single instance, not yet suitable for a multi-instance production deploy.
