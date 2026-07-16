-- ============================================================
-- 048_business_workspace_whatsapp_personal.sql — QR-linked personal
-- WhatsApp connection for Business Workspace.
--
-- Distinct from the existing whatsapp_config (official Cloud API)
-- table — this is a second, independent connection method for
-- tenants who want to link their own WhatsApp Business app (like
-- linking a device in WhatsApp's own "Linked Devices" feature) for
-- 1:1 chat capture, NOT for bulk broadcasting. There is no column or
-- code path here that connects this channel to broadcasts/campaigns.
--
-- The actual session credentials never touch this table or Supabase
-- at all — Baileys' own multi-file auth state lives on local VPS
-- disk (see src/lib/whatsapp-personal/socket-manager.ts), keeping
-- that sensitive material off the database entirely. This table only
-- tracks connection STATUS/metadata for the UI.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_whatsapp_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE UNIQUE,
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('disconnected', 'connecting', 'qr_pending', 'connected')),
  phone_number TEXT,
  connected_at TIMESTAMPTZ,
  last_disconnected_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_whatsapp_connections_account
  ON workspace_whatsapp_connections(account_id);

ALTER TABLE workspace_whatsapp_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_whatsapp_connections_select ON workspace_whatsapp_connections;
CREATE POLICY workspace_whatsapp_connections_select ON workspace_whatsapp_connections FOR SELECT
  USING (is_account_member(account_id));

-- Writes go through the server (service-role-equivalent via the
-- caller's own admin-checked API route), not directly from the
-- client — connecting/disconnecting a real WhatsApp session is a
-- sensitive, admin-only action even though this table itself doesn't
-- hold credentials.
DROP POLICY IF EXISTS workspace_whatsapp_connections_insert ON workspace_whatsapp_connections;
CREATE POLICY workspace_whatsapp_connections_insert ON workspace_whatsapp_connections FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS workspace_whatsapp_connections_update ON workspace_whatsapp_connections;
CREATE POLICY workspace_whatsapp_connections_update ON workspace_whatsapp_connections FOR UPDATE
  USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON workspace_whatsapp_connections;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON workspace_whatsapp_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- New Business Workspace feature flag — added after the original 13,
-- so it defaults to false for every existing tenant license row.
-- ============================================================
ALTER TABLE business_workspace_licenses
  ADD COLUMN IF NOT EXISTS whatsapp_personal_connect BOOLEAN NOT NULL DEFAULT false;
