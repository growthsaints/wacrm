import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for WhatsApp routes that need to
// see across accounts (currently: the phone-number claim check).
// Mirrors the pattern used by src/lib/automations/admin-client.ts and
// src/lib/platform/admin-client.ts.
let _adminClient: SupabaseClient | null = null

export function whatsappAdminClient(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
