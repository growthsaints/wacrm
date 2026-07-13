import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for platform-admin work: managing
// `platform_admins` rows and writing `impersonation_log` (neither has
// a client INSERT/UPDATE policy — service-role only), plus the Meta
// Admin API call impersonation needs (auth.admin.generateLink). Mirrors
// the pattern used by the webhook handler and src/lib/automations/admin-client.ts.
let _adminClient: SupabaseClient | null = null

export function platformAdminClient(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
