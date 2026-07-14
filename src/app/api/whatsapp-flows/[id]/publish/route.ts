import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { publishMetaFlow } from '@/lib/whatsapp/meta-api'

/**
 * POST /api/whatsapp-flows/[id]/publish
 *
 * Publishes the Flow on Meta (Part 3's "Publish Flow") and snapshots
 * the just-published JSON into whatsapp_flow_versions (Part 3's
 * "Versioning") before flipping local status to 'published'.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  try {
    await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: flow } = await supabase.from('whatsapp_flows').select('*').eq('id', id).maybeSingle()
  if (!flow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!flow.meta_flow_id) {
    return NextResponse.json({ error: 'Flow was never synced to Meta' }, { status: 409 })
  }
  if (flow.status === 'published') {
    return NextResponse.json({ error: 'Already published' }, { status: 409 })
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
    await publishMetaFlow({ flowId: flow.meta_flow_id, accessToken: decrypt(config.access_token) })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Meta publish failed' },
      { status: 502 },
    )
  }

  const nextVersion = (flow.current_version as number) + 1
  await admin.from('whatsapp_flow_versions').insert({
    whatsapp_flow_id: id,
    account_id: flow.account_id,
    version: nextVersion,
    flow_json: flow.flow_json,
    published_by: user.id,
  })

  const { data: updated, error } = await admin
    .from('whatsapp_flows')
    .update({ status: 'published', current_version: nextVersion })
    .eq('id', id)
    .select()
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ flow: updated })
}
