-- ============================================================
-- 061_daily_broadcast_quota.sql — guard broadcast sends against
-- Meta's per-24h messaging-limit tier, so an account can't blow past
-- its cap and risk Meta throttling/flagging the number (which can
-- cascade into a suspension).
--
-- Reuses whatsapp_config.messaging_limit_tier (already synced from
-- Meta by the existing "Refresh Status" action, migration 038) rather
-- than a new manually-entered number — see
-- src/lib/whatsapp/messaging-limit.ts for the tier→cap mapping.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_broadcasts_account_id
  ON broadcasts(account_id);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_sent_at
  ON broadcast_recipients(sent_at) WHERE sent_at IS NOT NULL;

-- ============================================================
-- count_recent_business_initiated_contacts — how many distinct
-- contacts this account has messaged (successfully) via Broadcasts in
-- the given lookback window. Distinct-by-contact because Meta counts
-- conversations, not messages — two template sends to the same
-- contact within the window are one conversation, not two.
-- ============================================================
CREATE OR REPLACE FUNCTION public.count_recent_business_initiated_contacts(
  p_account_id UUID,
  p_since TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT br.contact_id)::INTEGER
  FROM broadcast_recipients br
  JOIN broadcasts b ON b.id = br.broadcast_id
  WHERE b.account_id = p_account_id
    AND br.sent_at >= p_since
    AND br.status IN ('sent', 'delivered', 'read', 'replied');
$$;

REVOKE ALL ON FUNCTION public.count_recent_business_initiated_contacts(UUID, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_recent_business_initiated_contacts(UUID, TIMESTAMPTZ) TO authenticated, service_role;
