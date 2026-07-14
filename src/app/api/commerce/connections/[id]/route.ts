import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/commerce/admin-client'

/**
 * DELETE /api/commerce/connections/[id] — disconnect. Synced
 * commerce_* rows are left in place (historical order/purchase-history
 * data shouldn't vanish because the store integration was removed);
 * only the connection + its credentials are deleted.
 * POST   /api/commerce/connections/[id] — re-queue a full sync.
 */

async function requireOwnership(id: string) {
  const supabase = await createClient()
  const { data: conn } = await supabase
    .from('commerce_connections')
    .select('id, account_id')
    .eq('id', id)
    .maybeSingle()
  return conn as { id: string; account_id: string } | null
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  try {
    await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }
  const conn = await requireOwnership(id)
  if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await supabaseAdmin().from('commerce_connections').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  try {
    await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }
  const conn = await requireOwnership(id)
  if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await supabaseAdmin().from('automation_jobs').insert({
    account_id: conn.account_id,
    job_type: 'commerce_sync',
    payload: { connectionId: id },
  })
  return NextResponse.json({ ok: true, queued: true })
}
