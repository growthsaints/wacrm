-- ============================================================
-- 060_create_team_member_direct.sql — let an admin+ create a team
-- member account directly (name/phone/email/password), instead of
-- only being able to generate a self-serve invite link.
--
-- handle_new_user (migration 017) always bootstraps a brand-new
-- personal account + 'owner' profile for every auth.users insert,
-- including ones made via the Admin API — so after the API route
-- creates the auth user, assign_team_member here moves that fresh
-- profile into the caller's account under the chosen role and drops
-- the now-orphaned personal account (mirrors what redeem_invitation
-- already does for the self-serve invite-link path).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- ============================================================
-- assign_team_member — service_role only. Never grant this to
-- `authenticated`: unlike redeem_invitation, it has no invite-token
-- check and no "does the caller already have data" safety check —
-- it trusts the caller completely, because the only caller is our
-- own API route (which has already verified the requesting admin's
-- role and just created p_user_id itself, moments earlier, via the
-- Supabase Admin API).
-- ============================================================
CREATE OR REPLACE FUNCTION public.assign_team_member(
  p_user_id UUID,
  p_account_id UUID,
  p_role account_role_enum,
  p_phone TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_account_id UUID;
BEGIN
  IF p_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot create a second owner this way' USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_old_account_id FROM profiles WHERE user_id = p_user_id;
  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'No profile found for user %', p_user_id USING ERRCODE = '42501';
  END IF;

  UPDATE profiles
  SET account_id = p_account_id,
      account_role = p_role,
      phone = p_phone
  WHERE user_id = p_user_id;

  -- Clean up the orphaned personal account handle_new_user just
  -- created for this brand-new signup. Safe unconditionally — the
  -- account is guaranteed empty, it's seconds old and only this
  -- function has touched it.
  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN p_account_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_team_member(UUID, UUID, account_role_enum, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_team_member(UUID, UUID, account_role_enum, TEXT) TO service_role;
