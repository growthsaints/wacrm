-- ============================================================
-- 054_announcements_media_mentions.sql — three independent additions:
--   1. workspace_announcements — Team Workspace Announcements
--      (admin+ posts, broadcast-style, distinct from Internal Chat's
--      1:1/group messaging).
--   2. campaign-media storage bucket — real file uploads for Campaign
--      Planner (previously just a free-text media_url field).
--   3. notifications.type widened to add 'mention' — Shared Inbox's
--      "Internal Notes" reuses the existing contact_notes table (no
--      new table needed there), but @mentioning a teammate in a note
--      needs a notification type that didn't exist yet.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content_text TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_announcements_account
  ON workspace_announcements(account_id, created_at DESC);

ALTER TABLE workspace_announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_announcements_select ON workspace_announcements;
CREATE POLICY workspace_announcements_select ON workspace_announcements FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS workspace_announcements_insert ON workspace_announcements;
CREATE POLICY workspace_announcements_insert ON workspace_announcements FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS workspace_announcements_delete ON workspace_announcements;
CREATE POLICY workspace_announcements_delete ON workspace_announcements FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- campaign-media storage bucket — same account-scoped-folder RLS
-- pattern as chat-media (migration 023) and flow-media (migration 016).
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'campaign-media',
  'campaign-media',
  TRUE,
  16777216, -- 16 MB, matching chat-media's cap
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp',
    'video/mp4', 'video/3gpp',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Campaign media is publicly readable" ON storage.objects;
CREATE POLICY "Campaign media is publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'campaign-media');

DROP POLICY IF EXISTS "Members can upload campaign media" ON storage.objects;
CREATE POLICY "Members can upload campaign media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'campaign-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete campaign media" ON storage.objects;
CREATE POLICY "Members can delete campaign media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'campaign-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- ============================================================
-- notifications.type widened for @mentions in Shared Inbox notes
-- (contact_notes — no new table). Same dynamic-constraint-name
-- lookup as migration 052, since this one was also declared inline.
-- ============================================================
DO $$
DECLARE
  existing_constraint_name text;
BEGIN
  SELECT con.conname INTO existing_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'notifications'
    AND con.contype = 'c'
    AND att.attname = 'type';

  IF existing_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', existing_constraint_name);
  END IF;
END $$;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'mention'));
