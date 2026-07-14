import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getMetaFlow } from '@/lib/whatsapp/meta-api'

/**
 * GET /api/whatsapp-flows/[id]/preview
 *
 * Fetches a short-lived preview URL + current status from Meta (Part
 * 3's "Preview"). Not cached locally — Meta's preview links expire,
 * so this is always a live round-trip.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const supabase = await createClient()
  const { data: flow } = await supabase.from('whatsapp_flows').select('*').eq('id', id).maybeSingle()
  if (!flow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!flow.meta_flow_id) {
    return NextResponse.json({ error: 'Flow was never synced to Meta' }, { status: 409 })
  }

  const admin = supabaseAdmin()
  const { data: config } = await admin
    .from('whatsapp_config')
    .select('access_token')
    .eq('account_id', flow.account_id)
    .maybeSingle()
  if (!config) {
    return NextResponse.json({ error: 'WhatsApp not configured for this account' }, { status: 400 })
  }

  try {
    const meta = await getMetaFlow({ flowId: flow.meta_flow_id, accessToken: decrypt(config.access_token) })
    if (meta.preview?.preview_url) {
      await admin
        .from('whatsapp_flows')
        .update({ preview_url: meta.preview.preview_url, last_synced_at: new Date().toISOString() })
        .eq('id', id)
    }
    return NextResponse.json({ status: meta.status, preview_url: meta.preview?.preview_url ?? null })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Meta preview fetch failed' },
      { status: 502 },
    )
  }
}
