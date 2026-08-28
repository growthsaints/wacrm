// ============================================================
// Builds/refreshes one Custom Audience on Meta from a
// meta_custom_audiences row's saved audience_filter. Runs inside the
// API route's after() callback (same "ack fast, do the real work
// after responding" pattern as the WhatsApp webhook and broadcast
// delivery) since resolving + hashing + uploading a large CRM segment
// can take longer than a request should block on.
//
// Never throws — every failure path marks the row 'failed' with a
// human-readable reason instead, since there's no caller left to
// receive an exception once this runs in the background.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/meta-ads/encryption'
import {
  addPhonesToCustomAudience,
  createCustomAudience,
  hashPhoneForCustomAudience,
} from '@/lib/meta-ads/client'
import { resolveAudienceContacts, type AudienceFilter } from '@/lib/meta-ads/audience'

// Meta's documented cap on rows per /customaudiences/{id}/users call.
const META_UPLOAD_BATCH_SIZE = 10000

async function markFailed(db: SupabaseClient, audienceRowId: string, message: string): Promise<void> {
  const { error } = await db
    .from('meta_custom_audiences')
    .update({ status: 'failed', error_message: message, updated_at: new Date().toISOString() })
    .eq('id', audienceRowId)
  if (error) {
    console.error('[meta-ads/sync] failed to mark audience failed:', error.message)
  }
}

export async function syncCustomAudience(db: SupabaseClient, audienceRowId: string): Promise<void> {
  try {
    const { data: row, error: rowError } = await db
      .from('meta_custom_audiences')
      .select('id, meta_ads_config_id, meta_audience_id, name, audience_filter')
      .eq('id', audienceRowId)
      .maybeSingle()
    if (rowError || !row) return

    const { data: config, error: configError } = await db
      .from('meta_ads_config')
      .select('ad_account_id, access_token, enabled')
      .eq('id', row.meta_ads_config_id)
      .maybeSingle()
    if (configError || !config) {
      await markFailed(db, audienceRowId, 'Ad account is no longer connected')
      return
    }
    if (!config.enabled) {
      await markFailed(db, audienceRowId, 'Ad account connection is disabled')
      return
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      await markFailed(db, audienceRowId, 'Stored access token could not be decrypted — reconnect the ad account')
      return
    }

    const contacts = await resolveAudienceContacts(db, row.audience_filter as AudienceFilter)

    let metaAudienceId = row.meta_audience_id as string | null
    if (!metaAudienceId) {
      const created = await createCustomAudience({
        accessToken,
        adAccountId: config.ad_account_id,
        name: row.name,
      })
      metaAudienceId = created.id
      await db
        .from('meta_custom_audiences')
        .update({ meta_audience_id: metaAudienceId })
        .eq('id', audienceRowId)
    }

    const hashed = contacts.map((c) => hashPhoneForCustomAudience(c.phone))
    for (let i = 0; i < hashed.length; i += META_UPLOAD_BATCH_SIZE) {
      const batch = hashed.slice(i, i + META_UPLOAD_BATCH_SIZE)
      await addPhonesToCustomAudience({ accessToken, metaAudienceId, hashedPhones: batch })
    }

    const { error: doneError } = await db
      .from('meta_custom_audiences')
      .update({
        status: 'ready',
        contact_count: contacts.length,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', audienceRowId)
    if (doneError) {
      console.error('[meta-ads/sync] failed to mark audience ready:', doneError.message)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error syncing the audience to Meta'
    console.error('[meta-ads/sync] sync failed:', message)
    await markFailed(db, audienceRowId, message)
  }
}
