import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { updateMetaFlowJson } from '@/lib/whatsapp/meta-api'

/**
 * GET    /api/whatsapp-flows/[id] — fetch one flow (incl. flow_json).
 * PUT    /api/whatsapp-flows/[id] — update the JSON while still draft
 *        (Meta makes a published Flow's JSON immutable — see the
 *        publish route for the "new Flow for further edits" pattern).
 * DELETE /api/whatsapp-flows/[id] — remove locally. Meta has no
 *        delete for a published Flow; deprecate handles that case.
 */

async function requireOwnership(id: string) {
  const supabase = await createClient()
  const { data: flow } = await supabase.from('whatsapp_flows').select('*').eq('id', id).maybeSingle()
  return flow
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const flow = await requireOwnership(id)
  if (!flow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ flow })
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  try {
    await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const flow = await requireOwnership(id)
  if (!flow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (flow.status === 'published') {
    return NextResponse.json(
      { error: 'Published Flows are immutable in Meta — create a new Flow to change its screens.' },
      { status: 409 },
    )
  }

  const body = (await request.json().catch(() => null)) as
    | { name?: string; flow_json?: Record<string, unknown> }
    | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const admin = supabaseAdmin()

  if (body.flow_json && flow.meta_flow_id) {
    const { data: config } = await admin
      .from('whatsapp_config')
      .select('access_token')
      .eq('account_id', flow.account_id)
      .maybeSingle()
    if (config) {
      try {
        await updateMetaFlowJson({
          flowId: flow.meta_flow_id,
          accessToken: decrypt(config.access_token),
          flowJson: body.flow_json,
        })
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'Meta Flow JSON update failed' },
          { status: 502 },
        )
      }
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) patch.name = body.name
  if (body.flow_json !== undefined) {
    patch.flow_json = body.flow_json
    patch.last_synced_at = new Date().toISOString()
  }

  const { data: updated, error } = await admin
    .from('whatsapp_flows')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ flow: updated })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  try {
    await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }
  const flow = await requireOwnership(id)
  if (!flow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await supabaseAdmin().from('whatsapp_flows').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
