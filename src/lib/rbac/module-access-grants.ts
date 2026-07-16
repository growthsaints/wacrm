import type { SupabaseClient } from '@supabase/supabase-js'

export type GatedModule = 'enterprise' | 'business_workspace'

/**
 * Whether the CALLING user (derived from the passed client's own
 * session — no accountId/userId juggling needed at call sites) has
 * been explicitly granted access to a module that gates admins by
 * default. Owners never need a grant — this is only ever consulted
 * for 'admin' role callers; see requireEnterpriseFeature /
 * requireBusinessWorkspaceFeature.
 */
export async function hasModuleAccessGrant(
  supabase: SupabaseClient,
  accountId: string,
  module: GatedModule,
): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false

  const { data } = await supabase
    .from('module_access_grants')
    .select('id')
    .eq('account_id', accountId)
    .eq('user_id', user.id)
    .eq('module', module)
    .maybeSingle()

  return !!data
}
