-- ============================================================
-- 070_contact_consent.sql — WhatsApp opt-in consent tracking.
--
-- A finer-grained companion to migration 062's `contacts
-- .marketing_opt_out` boolean. That flag answers "can we message this
-- contact" (a single yes/no broadcasts already respect); this table
-- answers "where did this number come from, did we ever ask for
-- consent, and how did they respond" — the audit trail Meta's own
-- WhatsApp Business Policy expects for numbers you didn't get an
-- inbound message from first (CSV imports, ads, website forms).
--
-- Lifecycle: a row starts `pending` when a consent-request template is
-- sent (out of scope for this migration — that trigger point, e.g. on
-- CSV import, is a separate feature); the customer's QUICK_REPLY
-- button tap (`YES_CONSENT` / `NO_CONSENT`) resolves it to `opted_in`
-- / `opted_out` (handled in the webhook — see
-- `lib/contacts/consent.ts`); `no_response` is for a cron/job to set
-- after a timeout (also out of scope here).
--
-- Design notes
--   - `account_id` (not `tenant_id`) — this codebase's tenancy key is
--     `accounts`, not a separate `tenants` table (see migration 017).
--   - `phone_number` is the primary matching key (not `contact_id`)
--     because a consent row can predate any contact ever being
--     created (a CSV row or ad lead you haven't messaged yet) — same
--     reasoning as `commerce_orders.customer_phone` elsewhere in this
--     codebase. `contact_id` is a nullable convenience link, populated
--     opportunistically once a matching contact exists.
--   - `unique(account_id, phone_number)` — one consent record per
--     number per account; re-sending a consent request updates the
--     existing row rather than creating a new one.
--   - Opting out here also flips `contacts.marketing_opt_out` (see
--     `lib/contacts/consent.ts`) so the existing broadcast-audience
--     exclusion (migration 062) immediately honors it — one
--     authoritative signal, not two that can drift apart.
--
-- RLS
--   Compliance/audit-class, same shape as `notification_rules`: any
--   member (viewer+) may read; only admin+ may create/update/delete
--   by hand. The inbound webhook and any future "send consent
--   request" job both run under the service-role client, which
--   bypasses RLS entirely (documented trust boundary throughout this
--   codebase).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_consent (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id               uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id               uuid REFERENCES contacts(id) ON DELETE SET NULL,
  phone_number             text NOT NULL,
  source                   text NOT NULL DEFAULT 'unknown'
    CHECK (source IN ('website', 'csv_import', 'meta_ads', 'manual', 'unknown')),

  consent_status           text NOT NULL DEFAULT 'pending'
    CHECK (consent_status IN ('pending', 'opted_in', 'opted_out', 'no_response')),

  consent_template_sent_at timestamptz,
  consent_responded_at     timestamptz,
  consent_response_payload text, -- the button payload received (e.g. "YES_CONSENT")

  imported_batch_id        uuid, -- ties a row back to the bulk import it came from

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  UNIQUE (account_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_contact_consent_status
  ON contact_consent (account_id, consent_status);
CREATE INDEX IF NOT EXISTS idx_contact_consent_phone
  ON contact_consent (account_id, phone_number);

-- Reuses the generic updated_at trigger function every other mutable
-- table in this codebase shares (see 001_initial_schema.sql).
DROP TRIGGER IF EXISTS set_updated_at ON contact_consent;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON contact_consent
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE contact_consent ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the account (viewer+) can see consent state.
DROP POLICY IF EXISTS contact_consent_select ON contact_consent;
CREATE POLICY contact_consent_select ON contact_consent FOR SELECT
  USING (is_account_member(account_id));

-- INSERT / UPDATE / DELETE: admin+ only (compliance-class, matching
-- notification_rules). The webhook's automatic status updates and any
-- future consent-request sender both use the service-role client and
-- bypass this RLS entirely.
DROP POLICY IF EXISTS contact_consent_insert ON contact_consent;
CREATE POLICY contact_consent_insert ON contact_consent FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS contact_consent_update ON contact_consent;
CREATE POLICY contact_consent_update ON contact_consent FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS contact_consent_delete ON contact_consent;
CREATE POLICY contact_consent_delete ON contact_consent FOR DELETE
  USING (is_account_member(account_id, 'admin'));
