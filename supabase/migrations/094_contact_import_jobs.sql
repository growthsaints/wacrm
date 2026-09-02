-- ============================================================
-- 094_contact_import_jobs.sql — tracks a CSV contact import that now
-- runs server-side in the background (see lib/contacts/import-job.ts)
-- instead of as a long client-side loop in the browser tab.
--
-- Large imports (tens of thousands of rows) used to run entirely in
-- the browser: one sequential network round trip per insert chunk,
-- lost entirely if the tab was closed or the connection dropped
-- mid-import. This table lets the import kick off server-side (via
-- after(), same pattern as Meta Ads campaign launch and Custom
-- Audience sync) and lets the client poll progress instead of
-- blocking on it.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_import_jobs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'processing'
                          CHECK (status IN ('processing', 'completed', 'failed')),
  total_rows           INTEGER NOT NULL DEFAULT 0,
  processed_rows       INTEGER NOT NULL DEFAULT 0,
  imported_count       INTEGER NOT NULL DEFAULT 0,
  updated_count        INTEGER NOT NULL DEFAULT 0,
  skipped_count        INTEGER NOT NULL DEFAULT 0,
  failed_count         INTEGER NOT NULL DEFAULT 0,
  tags_assigned_count  INTEGER NOT NULL DEFAULT 0,
  error_message        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_import_jobs_account
  ON contact_import_jobs(account_id, created_at DESC);

ALTER TABLE contact_import_jobs ENABLE ROW LEVEL SECURITY;

-- Read: any account member (agent+, matching contacts_insert's floor —
-- a viewer can't start an import so has no job of their own to poll,
-- but is allowed to see one a teammate started, same as contacts
-- themselves are viewer-readable).
DROP POLICY IF EXISTS contact_import_jobs_select ON contact_import_jobs;
CREATE POLICY contact_import_jobs_select ON contact_import_jobs FOR SELECT
  USING (is_account_member(account_id));

-- Create: agent+ only, matching contacts_insert (017_account_sharing.sql)
-- — importing contacts requires the same floor as creating one by hand.
DROP POLICY IF EXISTS contact_import_jobs_insert ON contact_import_jobs;
CREATE POLICY contact_import_jobs_insert ON contact_import_jobs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND created_by = auth.uid());

-- No authenticated UPDATE/DELETE policy: progress/status is only ever
-- written by the background job via the service-role client, which
-- bypasses RLS — there's no "edit" or "cancel" feature for a job row.
