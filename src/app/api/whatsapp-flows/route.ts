import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { createMetaFlow, updateMetaFlowJson } from '@/lib/whatsapp/meta-api'

/**
 * GET  /api/whatsapp-flows — list this account's WhatsApp Flows.
 * POST /api/whatsapp-flows — create a Flow, both locally and on Meta
 *      (Part 3's "Create Flow"). Starts in Meta's own DRAFT state;
 *      publishing is a separate step (POST .../publish) since Meta
 *      makes a published Flow's JSON immutable.
 */

const SELECT = 'id, name, meta_flow_id, categories, status, current_version, preview_url, last_synced_at, created_at, updated_at'

export async function GET() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('whatsapp_flows')
    .select(SELECT)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ flows: data ?? [] })
}

interface PostBody {
  name?: string
  categories?: string[]
  flow_json?: Record<string, unknown>
}

const VALID_CATEGORIES = new Set([
  'SIGN_UP', 'SIGN_IN', 'APPOINTMENT_BOOKING', 'LEAD_GENERATION',
  'CONTACT_US', 'CUSTOMER_SUPPORT', 'SURVEY', 'OTHER',
])

export async function POST(request: Request) {
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

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as PostBody | null
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  const categories = (body.categories ?? []).filter((c) => VALID_CATEGORIES.has(c))
  if (categories.length === 0) {
    return NextResponse.json({ error: 'At least one valid category is required' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data: config } = await admin
    .from('whatsapp_config')
    .select('waba_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!config?.waba_id) {
    return NextResponse.json(
      { error: 'Connect WhatsApp (Settings → WhatsApp) before creating Flows.' },
      { status: 400 },
    )
  }

  let metaFlowId: string | null = null
  try {
    const accessToken = decrypt(config.access_token)
    const created = await createMetaFlow({
      wabaId: config.waba_id,
      accessToken,
      name: body.name.trim(),
      categories,
    })
    metaFlowId = created.id
    if (body.flow_json) {
      await updateMetaFlowJson({ flowId: metaFlowId, accessToken, flowJson: body.flow_json })
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Meta Flow creation failed' },
      { status: 502 },
    )
  }

  const { data: flow, error } = await admin
    .from('whatsapp_flows')
    .insert({
      account_id: accountId,
      user_id: user.id,
      name: body.name.trim(),
      meta_flow_id: metaFlowId,
      categories,
      flow_json: body.flow_json ?? {},
      status: 'draft',
      last_synced_at: new Date().toISOString(),
    })
    .select(SELECT)
    .single()
  if (error || !flow) {
    return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 })
  }
  return NextResponse.json({ flow }, { status: 201 })
}
