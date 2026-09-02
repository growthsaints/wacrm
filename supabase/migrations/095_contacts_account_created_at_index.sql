-- ============================================================
-- 095_contacts_account_created_at_index.sql — composite index to
-- keep the Contacts page fast as an account's contact count grows.
--
-- The page's own query filters by account_id, sorts by created_at
-- DESC, and does an exact count (contacts/page.tsx's fetchContacts):
--
--   .from('contacts').select('*', { count: 'exact' })
--     .order('created_at', { ascending: false }).range(from, to)
--
-- Migration 017 only indexed account_id alone (idx_contacts_account).
-- Without created_at in the same index, Postgres has to sort every
-- matching row for the account before it can apply the page's
-- LIMIT/OFFSET — fine at a few hundred contacts, but a real account
-- that just imported ~48k contacts hit Supabase's statement timeout
-- on this exact query (observed: 500 after ~8s). This composite index
-- lets the planner satisfy the account filter, the sort, AND the
-- count from one index scan.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_contacts_account_created_at
  ON contacts(account_id, created_at DESC);
