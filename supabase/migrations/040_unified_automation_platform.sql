-- ============================================================
-- 040_unified_automation_platform.sql — Milestone 4
--
-- Consolidation strategy: rather than migrating the mature
-- `automations` (step-tree) engine's live data into the `flows`
-- (node-graph) engine's schema — high-risk with no compensating
-- benefit — this migration extends `flows` to be the ONE engine every
-- NEW automation surface builds on (unified triggers, unified node
-- vocabulary, WhatsApp Flows, commerce events). `automations` keeps
-- running untouched for existing customers; nothing here touches its
-- tables.
--
-- Sections:
--   1. flows / flow_nodes — widen trigger_type + node_type vocabulary.
--   2. flow_versions — publish-time snapshots (version history).
--   3. automation_jobs — unified retryable queue (delay nodes,
--      scheduled triggers, commerce sync) with backoff + idempotency,
--      built on the same claim-by-cron pattern already proven by
--      automation_pending_executions / the flows timeout sweep.
--   4. whatsapp_flows / whatsapp_flow_versions — official Meta Flows.
--   5. commerce_connections / commerce_customers / commerce_products /
--      commerce_orders / commerce_cart_events — WooCommerce + Shopify.
--   6. message_templates — flow-launch button support.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. flows / flow_nodes vocabulary
-- ============================================================

ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_trigger_type_check;
ALTER TABLE flows
  ADD CONSTRAINT flows_trigger_type_check
  CHECK (trigger_type IN (
    'keyword', 'first_inbound_message', 'manual',
    'tag_added', 'tag_removed',
    'conversation_started', 'conversation_closed',
    'template_delivered', 'template_read',
    'broadcast_completed',
    'order_created', 'order_paid', 'order_delivered', 'order_cancelled',
    'schedule', 'webhook', 'api'
  ));

ALTER TABLE flow_nodes DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;
ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_message', 'send_template', 'send_buttons', 'send_list',
    'send_media', 'send_whatsapp_flow',
    'collect_input', 'condition', 'branch',
    'set_tag', 'assign_agent',
    'create_contact', 'update_contact', 'update_custom_field',
    'delay', 'webhook', 'http_fetch',
    'handoff', 'end'
  ));

-- Category + search support for the flows list page (Part 9).
ALTER TABLE flows
  ADD COLUMN IF NOT EXISTS category TEXT,
  -- Inbound-webhook trigger auth token (trigger_type = 'webhook').
  -- Unique so a leaked token can be rotated by regenerating just this
  -- flow's value without affecting others.
  ADD COLUMN IF NOT EXISTS webhook_token TEXT UNIQUE,
  -- One-time or recurring config for trigger_type = 'schedule'.
  ADD COLUMN IF NOT EXISTS schedule_config JSONB,
  ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_flows_webhook_token
  ON flows(webhook_token) WHERE webhook_token IS NOT NULL;

-- ============================================================
-- 2. flow_versions — snapshot on publish (Part 9 version history)
-- ============================================================
CREATE TABLE IF NOT EXISTS flow_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id      UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  -- Full snapshot: { flow: {...}, nodes: [...] } — enough to restore.
  snapshot     JSONB NOT NULL,
  published_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (flow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_flow_versions_flow
  ON flow_versions(flow_id, version DESC);

ALTER TABLE flow_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flow_versions_select ON flow_versions;
CREATE POLICY flow_versions_select ON flow_versions FOR SELECT
  USING (is_account_member(account_id));
-- Writes are service-role only (publish flow via the API route).

-- ============================================================
-- 3. automation_jobs — unified retryable queue
--
-- Generalizes automation_pending_executions for every new engine
-- need: flow `delay` nodes, `schedule`-triggered runs, commerce sync
-- jobs. SKIP LOCKED gives safe concurrent dequeuing across multiple
-- cron invocations without a separate lock table; attempts/backoff +
-- idempotency_key give real retry semantics on top of Postgres,
-- rather than standing up a message broker this stack has no
-- infrastructure for.
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  job_type        TEXT NOT NULL CHECK (job_type IN (
                    'flow_resume', 'flow_scheduled', 'commerce_sync'
                  )),
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'done', 'failed', 'dead')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 5,
  -- Optional de-dupe key — a job insert with a key that already exists
  -- (pending/running) is a no-op at the application layer, and a
  -- UNIQUE index enforces it even under concurrent inserts.
  idempotency_key TEXT,
  run_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_jobs_idempotency
  ON automation_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_automation_jobs_due
  ON automation_jobs(run_at) WHERE status = 'pending';

ALTER TABLE automation_jobs ENABLE ROW LEVEL SECURITY;
-- Service-role only — no client policy, mirrors automation_pending_executions.

-- Concurrency-safe claim: locks + skips rows another worker already
-- has locked, so N parallel cron hits never double-process the same
-- job. Returns the claimed rows.
CREATE OR REPLACE FUNCTION public.claim_automation_jobs(p_limit INTEGER DEFAULT 25)
RETURNS SETOF automation_jobs
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE automation_jobs
  SET status = 'running', updated_at = now()
  WHERE id IN (
    SELECT id FROM automation_jobs
    WHERE status = 'pending' AND run_at <= now()
    ORDER BY run_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_automation_jobs(INTEGER) FROM PUBLIC;

-- ============================================================
-- 4. WhatsApp Flows (official Meta product)
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_flows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  -- Meta's Flow id (WABA-scoped resource). NULL until first synced to
  -- Meta — a flow can be authored locally before it exists remotely.
  meta_flow_id    TEXT,
  categories      TEXT[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'published', 'deprecated')),
  -- Meta Flow JSON (screens/routing model) — see
  -- https://developers.facebook.com/docs/whatsapp/flows/reference/flowjson
  flow_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_version INTEGER NOT NULL DEFAULT 0,
  preview_url     TEXT,
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, meta_flow_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_flows_account ON whatsapp_flows(account_id);

ALTER TABLE whatsapp_flows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_flows_select ON whatsapp_flows;
DROP POLICY IF EXISTS whatsapp_flows_insert ON whatsapp_flows;
DROP POLICY IF EXISTS whatsapp_flows_update ON whatsapp_flows;
DROP POLICY IF EXISTS whatsapp_flows_delete ON whatsapp_flows;
CREATE POLICY whatsapp_flows_select ON whatsapp_flows FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY whatsapp_flows_insert ON whatsapp_flows FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY whatsapp_flows_update ON whatsapp_flows FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY whatsapp_flows_delete ON whatsapp_flows FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_flows;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_flows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS whatsapp_flow_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_flow_id UUID NOT NULL REFERENCES whatsapp_flows(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  flow_json       JSONB NOT NULL,
  published_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (whatsapp_flow_id, version)
);

ALTER TABLE whatsapp_flow_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_flow_versions_select ON whatsapp_flow_versions;
CREATE POLICY whatsapp_flow_versions_select ON whatsapp_flow_versions FOR SELECT
  USING (is_account_member(account_id));

-- Flow send + completion tracking, attributed on the message row so
-- Flow Analytics can be derived from data we already collect rather
-- than a parallel counter table.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS whatsapp_flow_id UUID REFERENCES whatsapp_flows(id) ON DELETE SET NULL;

-- ============================================================
-- 5. Commerce integrations (WooCommerce + Shopify)
-- ============================================================
CREATE TABLE IF NOT EXISTS commerce_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform          TEXT NOT NULL CHECK (platform IN ('woocommerce', 'shopify')),
  store_url         TEXT NOT NULL,
  -- AES-256-GCM ciphertext (src/lib/whatsapp/encryption.ts — the same
  -- helper already used for WhatsApp tokens) of the platform
  -- credentials: WooCommerce consumer key/secret, or a Shopify Admin
  -- API access token. Never sent to the client.
  encrypted_credentials TEXT NOT NULL,
  -- Random per-connection secret used to verify inbound webhook
  -- signatures (WooCommerce's X-WC-Webhook-Signature HMAC, Shopify's
  -- X-Shopify-Hmac-Sha256) without a manual client-side setup step —
  -- the connection wizard registers the webhook with this secret
  -- programmatically via each platform's own REST API.
  webhook_secret    TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'connected'
                      CHECK (status IN ('connected', 'error', 'disconnected')),
  last_error        TEXT,
  last_synced_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, platform)
);

ALTER TABLE commerce_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_connections_select ON commerce_connections;
DROP POLICY IF EXISTS commerce_connections_modify ON commerce_connections;
CREATE POLICY commerce_connections_select ON commerce_connections FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY commerce_connections_modify ON commerce_connections FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON commerce_connections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON commerce_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS commerce_customers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id       UUID NOT NULL REFERENCES commerce_connections(id) ON DELETE CASCADE,
  contact_id          UUID REFERENCES contacts(id) ON DELETE SET NULL,
  external_customer_id TEXT NOT NULL,
  email               TEXT,
  phone               TEXT,
  name                TEXT,
  total_spent         NUMERIC(12,2) NOT NULL DEFAULT 0,
  orders_count        INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_customers_contact
  ON commerce_customers(contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE commerce_customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_customers_select ON commerce_customers;
CREATE POLICY commerce_customers_select ON commerce_customers FOR SELECT
  USING (is_account_member(account_id));

CREATE TABLE IF NOT EXISTS commerce_products (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id      UUID NOT NULL REFERENCES commerce_connections(id) ON DELETE CASCADE,
  external_product_id TEXT NOT NULL,
  name               TEXT NOT NULL,
  sku                TEXT,
  price              NUMERIC(12,2),
  currency           TEXT,
  image_url          TEXT,
  inventory_qty      INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_product_id)
);

ALTER TABLE commerce_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_products_select ON commerce_products;
CREATE POLICY commerce_products_select ON commerce_products FOR SELECT
  USING (is_account_member(account_id));

CREATE TABLE IF NOT EXISTS commerce_orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id    UUID NOT NULL REFERENCES commerce_connections(id) ON DELETE CASCADE,
  contact_id       UUID REFERENCES contacts(id) ON DELETE SET NULL,
  external_order_id TEXT NOT NULL,
  order_number     TEXT,
  status           TEXT NOT NULL DEFAULT 'created' CHECK (status IN (
                     'created', 'paid', 'processing', 'shipped',
                     'delivered', 'cancelled', 'refunded'
                   )),
  payment_status   TEXT,
  shipping_status  TEXT,
  total            NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'USD',
  customer_email   TEXT,
  customer_phone   TEXT,
  line_items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  placed_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_order_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_orders_contact
  ON commerce_orders(contact_id, placed_at DESC) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commerce_orders_account
  ON commerce_orders(account_id, placed_at DESC);

ALTER TABLE commerce_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_orders_select ON commerce_orders;
CREATE POLICY commerce_orders_select ON commerce_orders FOR SELECT
  USING (is_account_member(account_id));

DROP TRIGGER IF EXISTS set_updated_at ON commerce_orders;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON commerce_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Abandoned cart. Shopify exposes checkout webhooks natively
-- (checkouts/create, checkouts/update); WooCommerce core has no
-- equivalent without a cart-tracking plugin — connections of that
-- platform simply never populate this table, which the UI surfaces
-- as "not available for WooCommerce" rather than faking data.
CREATE TABLE IF NOT EXISTS commerce_cart_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id       UUID NOT NULL REFERENCES commerce_connections(id) ON DELETE CASCADE,
  contact_id          UUID REFERENCES contacts(id) ON DELETE SET NULL,
  external_checkout_id TEXT NOT NULL,
  email               TEXT,
  phone               TEXT,
  cart_value          NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'USD',
  line_items          JSONB NOT NULL DEFAULT '[]'::jsonb,
  status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'abandoned', 'recovered', 'converted')),
  abandoned_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_checkout_id)
);

ALTER TABLE commerce_cart_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_cart_events_select ON commerce_cart_events;
CREATE POLICY commerce_cart_events_select ON commerce_cart_events FOR SELECT
  USING (is_account_member(account_id));

-- ============================================================
-- 6. message_templates — flow-launch button support
-- ============================================================
ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS whatsapp_flow_id UUID REFERENCES whatsapp_flows(id) ON DELETE SET NULL;
