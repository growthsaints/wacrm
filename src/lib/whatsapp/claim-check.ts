// ============================================================
// Shared "is this phone number already claimed by another account?"
// check. wacrm is single-tenant per WhatsApp number
// (whatsapp_config_phone_number_id_key, migration 013) — letting two
// accounts bind the same number breaks the webhook's owning-config
// lookup (issue #136). Both the manual save route and the automatic
// Embedded Signup completion route must reject that the same way.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ClaimCheckResult {
  claimedByAnotherAccount: boolean
}

/**
 * Uses the service-role client because under RLS a caller's own
 * session can't see another account's rows — the conflict would be
 * invisible without it.
 */
export async function checkPhoneNumberClaim(
  adminClient: SupabaseClient,
  phoneNumberId: string,
  callerAccountId: string,
): Promise<ClaimCheckResult> {
  const { data, error } = await adminClient
    .from('whatsapp_config')
    .select('account_id')
    .eq('phone_number_id', phoneNumberId)
    .neq('account_id', callerAccountId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to validate configuration: ${error.message}`)
  }

  return { claimedByAnotherAccount: !!data }
}
