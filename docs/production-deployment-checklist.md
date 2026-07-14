# Production Deployment Checklist — wa.growthsaint.com

Target stack: Hostinger VPS + Supabase + Meta + HTTPS. This is an
operational checklist, not a code change — nothing here alters product
behavior. Work through it in order; each section assumes the previous
one is done.

---

## 0. Repository pre-flight (do this first, locally or in CI)

- [ ] `npm ci`
- [ ] `npm run lint` — must be 0 errors (warnings pre-exist, not new)
- [ ] `npx tsc --noEmit` — must be clean
- [ ] `npm test` — must be 100% passing
- [ ] `npm run build` — must succeed (use dummy env vars locally; real
      ones come from the VPS's `.env.production` at deploy time)
- [ ] Confirm you're deploying the intended branch/commit (`git log -1`)
- [ ] Confirm `supabase/migrations/` runs through **040** (40 files,
      `001_initial_schema.sql` → `040_unified_automation_platform.sql`)

---

## 1. Supabase (production project)

1. **Create the project** (or confirm the one you're pointed at is the
   real production project, not a dev/staging one).
2. **Apply every migration in order**, 001 → 040:
   - Easiest: Supabase SQL Editor, paste each file in numeric order and
     run it. All migrations are idempotent (`IF NOT EXISTS` / `DROP …
     IF EXISTS` guards throughout) — safe to re-run if you're unsure
     whether one applied.
   - Or via the Supabase CLI: `supabase link --project-ref <ref>` then
     `supabase db push` from the repo root.
3. **Authentication → Providers → Email**: enabled (required for
   sign-in; also underpins platform-admin impersonation's
   `generateLink`/`verifyOtp`).
4. **Extensions**: `uuid-ossp` and `vector` are created by migrations
   001 and 030 respectively (`CREATE EXTENSION IF NOT EXISTS`) — no
   manual step, just confirm no errors during migration.
5. **Realtime**: on by default for new projects. The app subscribes to
   `flow_runs`, `member_presence`, conversations/messages, etc. — no
   manual publication setup beyond what the migrations already added
   (`ALTER PUBLICATION supabase_realtime ADD TABLE …`, already run in
   step 2).
6. **Copy these three values** (Project Settings → API) — you'll need
   them in §4:
   - Project URL
   - `anon` public key
   - `service_role` secret key (never expose client-side)

---

## 2. Meta (WhatsApp Business Platform)

You need **one Meta App** (the Growth Saints "Tech Provider" app every
tenant connects through — tenants never create their own).

1. Create the app at [developers.facebook.com](https://developers.facebook.com) — type **Business**, linked to your Business Manager.
2. **Add products**: `WhatsApp` and `Facebook Login for Business`.
3. **Facebook Login for Business → Configurations → Create
   configuration**, use case **WhatsApp Embedded Signup**. Note the
   `config_id` — this becomes `NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID`.
   Request permissions:
   - `whatsapp_business_management` — required
   - `whatsapp_business_messaging` — required
   - `business_management` — recommended (nicer "Business Name"
     display; not required)
4. **Settings → Basic → App Domains**: add `wa.growthsaint.com`. The
   Embedded Signup popup will not load from a domain not listed here.
5. **App mode**: Development mode only works for your own
   test businesses/admins. To connect a real, unrelated client
   business you need **Live** mode, which requires:
   - App Review approval for the two `whatsapp_business_*` permissions
     (submit a screen recording of the Embedded Signup flow).
   - Business Verification on the owning Business Manager (Meta
     Business Suite → Security Center → Start verification). This is
     an external, human-reviewed process — budget hours to days.
   - **For your first internal test pass**, you can skip both and add
     the specific test business/number as a tester under App Roles —
     the full pipeline works end-to-end in Development mode against
     test users.
6. **WhatsApp → Configuration → Webhook** (configured once, shared by
   every tenant connected via Embedded Signup):
   - Callback URL: `https://wa.growthsaint.com/api/whatsapp/webhook`
   - Verify token: a long random string you generate — this becomes
     `META_WEBHOOK_VERIFY_TOKEN` (must match exactly)
   - Subscribe: `messages` (**required**), plus
     `message_template_status_update`, `message_template_quality_update`,
     `message_template_components_update` (recommended)
7. Note your **App ID** and **App Secret** (Settings → Basic) — these
   become `META_APP_ID` / `NEXT_PUBLIC_META_APP_ID` and
   `META_APP_SECRET`.

> The webhook callback URL will 403/verify-fail until the VPS is live
> and serving HTTPS — do §3–§5 first, then come back and click
> "Verify and save" on the webhook subscription.

---

## 3. Hostinger VPS — base setup

SSH into the VPS as a non-root sudo user (create one if you only have
root) for everything below.

1. **Node.js 20+** (repo requires `>=20.0.0`, `package.json` `engines`):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   node -v   # confirm v20.x or newer
   ```
2. **Nginx** (reverse proxy + TLS termination):
   ```bash
   sudo apt-get install -y nginx
   ```
3. **PM2** (process manager, keeps the app running + restarts on
   crash/reboot):
   ```bash
   sudo npm install -g pm2
   ```
4. **Firewall**: allow SSH, HTTP, HTTPS only.
   ```bash
   sudo ufw allow OpenSSH
   sudo ufw allow 'Nginx Full'
   sudo ufw enable
   ```
5. **Clone the repo** to e.g. `/var/www/wacrm`:
   ```bash
   sudo mkdir -p /var/www/wacrm && sudo chown $USER:$USER /var/www/wacrm
   git clone <your-repo-url> /var/www/wacrm
   cd /var/www/wacrm
   ```

---

## 4. DNS + HTTPS

1. In your DNS provider (wherever `growthsaint.com` is managed), add an
   **A record**: `wa` → the VPS's public IPv4 (and an AAAA record if
   the VPS has IPv6). Wait for propagation (`dig wa.growthsaint.com`).
2. Copy `deploy/nginx.conf.example` into place and enable it:
   ```bash
   sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/wa.growthsaint.com
   sudo ln -s /etc/nginx/sites-available/wa.growthsaint.com /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```
3. **Certbot** (free TLS cert, auto-renewing):
   ```bash
   sudo apt-get install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d wa.growthsaint.com
   ```
   Certbot rewrites the Nginx server block to add the TLS
   `listen 443 ssl` directives and an HTTP→HTTPS redirect.
4. Confirm: `https://wa.growthsaint.com` reaches Nginx (502 is expected
   right now — the Next.js app isn't running yet; that's §5).

---

## 5. Environment variables

Create `/var/www/wacrm/.env.production` (never commit this file — it's
already gitignored via `.env*`). Reference: `.env.local.example` in the
repo has inline docs for every one of these.

### Required — the app won't start / core features silently break without these

| Variable | Why |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (§1.6) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (§1.6) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (§1.6) — webhook, engines, public API auth, commerce sync all use this |
| `ENCRYPTION_KEY` | 64 hex chars. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Encrypts WhatsApp tokens + commerce store credentials (AES-256-GCM) |
| `META_APP_SECRET` | Meta App Secret (§2.7) — verifies inbound webhook HMAC signatures |

### Required for this deployment's actual use (Embedded Signup, cron, commerce)

| Variable | Why |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://wa.growthsaint.com` — canonical origin. Used for invite links **and** the Commerce connection wizard's webhook delivery URL. **Rebuild after setting this** (baked into the client bundle) |
| `META_APP_ID` / `NEXT_PUBLIC_META_APP_ID` | Same value, twice (§2.7) — server-side token exchange + client-side FB SDK init |
| `NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID` | Facebook Login for Business config id (§2.3) |
| `META_WEBHOOK_VERIFY_TOKEN` | Must exactly match what you set in §2.6 |
| `AUTOMATION_CRON_SECRET` | Generate: `openssl rand -hex 32`. Shared by **three** cron endpoints (§6) — automations' Wait steps, flows' timeout sweep, and the unified automation_jobs queue (delay nodes, scheduled flows, commerce sync) |
| `PLATFORM_ADMIN_BOOTSTRAP_EMAILS` | Your own email, comma-separated if more than one. Set **before** your first login — it's the only way to seat the first Super Admin |

### Optional (only if you use the feature)

| Variable | Why |
|---|---|
| `NEXT_PUBLIC_APP_LOCALE` | Defaults to `en` |
| `ALLOWED_INVITE_HOSTS` | Belt-and-braces host allow-list; skip if `NEXT_PUBLIC_SITE_URL` is set |
| `WHATSAPP_TEMPLATES_DRY_RUN` | **Must be unset (or `false`) in production** — leaving it `true` fakes template submissions |
| `AI_REQUEST_TIMEOUT_MS`, `AI_CONTEXT_MESSAGE_LIMIT` | AI assistant tuning; each account brings its own provider key, no global key needed |

- [ ] `.env.production` written, all Required rows filled in
- [ ] File permissions locked down: `chmod 600 .env.production`

---

## 6. Build, start, and scheduled jobs

1. **Install + build**:
   ```bash
   cd /var/www/wacrm
   npm ci
   npm run build
   ```
2. **Start under PM2**:
   ```bash
   pm2 start deploy/ecosystem.config.js
   pm2 save
   pm2 startup   # run the printed command once, so PM2 survives a reboot
   ```
3. Confirm: `https://wa.growthsaint.com` now loads the login page
   (Nginx's 502 from §4.4 should be gone).
4. **Cron jobs** — three endpoints, all gated by the same
   `x-cron-secret: $AUTOMATION_CRON_SECRET` header. Without these,
   automation "Wait" steps, flow timeouts/delays, and scheduled flows
   never fire — everything else works, but anything with a delay in it
   silently never resumes.
   ```bash
   crontab -e
   ```
   ```cron
   # Automations engine — drains Wait-step pending executions
   */5 * * * * curl -s -H "x-cron-secret: $AUTOMATION_CRON_SECRET" https://wa.growthsaint.com/api/automations/cron > /dev/null

   # Flows engine — sweeps abandoned/timed-out conversational runs
   */5 * * * * curl -s -H "x-cron-secret: $AUTOMATION_CRON_SECRET" https://wa.growthsaint.com/api/flows/cron > /dev/null

   # Unified automation_jobs queue — delay nodes, scheduled flows, commerce sync
   */5 * * * * curl -s -H "x-cron-secret: $AUTOMATION_CRON_SECRET" https://wa.growthsaint.com/api/automation-jobs/cron > /dev/null
   ```
   (`$AUTOMATION_CRON_SECRET` needs to be the literal value, not an
   env reference — cron doesn't read `.env.production`. Either paste
   the value directly into the crontab or `set -a; . /var/www/wacrm/.env.production; set +a` at the top of a wrapper script.)
- [ ] Deployed and reachable over HTTPS
- [ ] `pm2 status` shows `wacrm` as `online`
- [ ] All three cron lines added and firing (check `pm2 logs wacrm` or
      the endpoints' own 200 response) after 5 minutes

---

## 7. Close the loop with Meta

- [ ] Back in the Meta App dashboard (§2.6), click **Verify and save**
      on the webhook subscription — should now succeed (VPS is live).
- [ ] Set `PLATFORM_ADMIN_BOOTSTRAP_EMAILS` (§5) if not already done,
      restart PM2 (`pm2 restart wacrm`) so it's picked up.

---

## 8. Post-deployment verification (your list, in a sensible order)

### 8.1 Platform admin bootstrap
- [ ] Sign up/in as the `PLATFORM_ADMIN_BOOTSTRAP_EMAILS` address
- [ ] `/platform` loads without redirect

### 8.2 Connect one real WhatsApp Business Account (Embedded Signup)
- [ ] Settings → WhatsApp → **Continue with Facebook** → popup opens
- [ ] Complete: select Business Manager → WABA → phone number → grant permissions
- [ ] Management panel populates (Business Name, Phone Number, status = connected)

### 8.3 Send and receive messages
- [ ] Send a real WhatsApp message to the connected number from an
      external phone → appears in Inbox within seconds
- [ ] Reply from the Inbox → delivered to the external phone
- [ ] Delivered/read receipts update on the sent message

### 8.4 Verify Embedded Signup (error paths)
- [ ] Templates already approved on that WABA appear under Settings →
      Templates without a manual Sync click
- [ ] Disconnect → Reconnect the same number succeeds cleanly

### 8.5 Verify Webhooks
- [ ] Inbound message webhook lands (§8.3 already proves this)
- [ ] Send a template message, confirm `template_delivered` /
      `template_read` show up (Meta status callbacks →
      `handleStatusUpdate` → unified engine dispatch)
- [ ] If using outbound webhook subscriptions (Settings → API →
      Webhooks), fire a test event and confirm delivery

### 8.6 Verify Campaigns (Broadcasts)
- [ ] Create a broadcast against a small real audience, schedule/send
- [ ] Sent/Delivered/Read/Failed counts update on the Broadcasts page
- [ ] A reply from a recipient marks their row `replied`

### 8.7 Verify Flows
- [ ] Build or use a template flow (keyword trigger), activate it
- [ ] Message the connected number with the trigger keyword → bot
      responds, buttons/lists work, handoff/end behave correctly
- [ ] Check `/flows/[id]/runs` shows the run with correct status

### 8.8 Verify Commerce integrations
- [ ] Settings → Commerce → **Connect WooCommerce** (or Shopify) with
      real store credentials → validates against the live store API
- [ ] Confirm the connection shows `connected` and webhooks were
      registered (check the store's own webhook settings page — you
      should see new entries pointing at
      `https://wa.growthsaint.com/api/commerce/...`)
- [ ] Place a real test order in the store → order appears in
      Growth Saints CRM (Contact's Order Information / timeline) within
      a minute or two, and — if the contact's phone matches — a
      WhatsApp order notification is sent

---

## 9. Known limitations to plan around

- Business Verification + Meta App Review are external, human-reviewed
  processes with no code-side shortcut — plan calendar time before
  onboarding a real unrelated client business (Development-mode
  testers are exempt, see §2.5).
- One WhatsApp number per organization is the existing invariant.
- The in-memory rate limiter (`src/lib/rate-limit.ts`) is per-process —
  fine for a single-VPS deployment (this checklist), not yet suitable
  if you later scale to multiple app instances behind a load balancer.
- WooCommerce has no native abandoned-cart webhook (Shopify does) —
  that feature is a documented no-op for WooCommerce connections.
- `broadcast_completed` and manual (UI) conversation-close actions
  don't yet dispatch into the Flows trigger system (schema-ready, not
  wired) — everything else in §8 is fully wired.
