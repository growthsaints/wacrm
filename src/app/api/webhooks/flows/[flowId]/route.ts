import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { startFlowRunForContact } from '@/lib/flows/engine'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'

/**
 * POST /api/webhooks/flows/[flowId]?token=<flows.webhook_token>
 *
 * Inbound-webhook trigger (Part 6's `webhook` trigger type) — an
 * external system (Zapier, another CRM, a form backend) can start
 * this specific flow for a contact. Auth is the per-flow token shown
 * in the builder's trigger panel, not an account-wide API key — a
 * distinct trigger surface from `POST /api/v1/flows/trigger`
 * (which is deliberately account-scoped and API-key gated instead).
 *
 * Body: { contact_id } OR { phone, name? }
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ flowId: string }> },
) {
  const { flowId } = await context.params
  const token = new URL(request.url).searchParams.get('token')
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 401 })
  }

  const db = supabaseAdmin()
  const { data: flow } = await db
    .from('flows')
    .select('id, account_id, status, webhook_token')
    .eq('id', flowId)
    .eq('trigger_type', 'webhook')
    .maybeSingle()
  if (!flow || !flow.webhook_token || flow.webhook_token !== token) {
    return NextResponse.json({ error: 'Invalid flow or token' }, { status: 401 })
  }
  if (flow.status !== 'active') {
    return NextResponse.json({ error: 'Flow is not active' }, { status: 409 })
  }

  const body = (await request.json().catch(() => null)) as
    | { contact_id?: string; phone?: string; name?: string }
    | null
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let contactId = body.contact_id ?? null
  if (contactId) {
    const { data: owned } = await db
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', flow.account_id)
      .maybeSingle()
    if (!owned) {
      return NextResponse.json({ error: 'contact_id not found for this flow\'s account' }, { status: 404 })
    }
  } else if (body.phone) {
    const sanitized = sanitizePhoneForMeta(body.phone.trim())
    if (!isValidE164(sanitized)) {
      return NextResponse.json({ error: 'phone must be a valid E.164 number' }, { status: 400 })
    }
    const existing = await findExistingContact(db, flow.account_id, sanitized)
    if (existing) {
      contactId = existing.id
    } else {
      const { data: created, error } = await db
        .from('contacts')
        .insert({
          account_id: flow.account_id,
          user_id: (await db.from('accounts').select('owner_user_id').eq('id', flow.account_id).single()).data
            ?.owner_user_id,
          phone: sanitized,
          name: body.name || sanitized,
          source: 'api',
        })
        .select('id')
        .single()
      if (error || !created) {
        return NextResponse.json({ error: 'Failed to create contact' }, { status: 500 })
      }
      contactId = created.id
    }
  } else {
    return NextResponse.json({ error: "Either 'contact_id' or 'phone' is required" }, { status: 400 })
  }

  const result = await startFlowRunForContact(flowId, contactId as string)
  return NextResponse.json({ contact_id: contactId, ...result }, { status: 201 })
}
