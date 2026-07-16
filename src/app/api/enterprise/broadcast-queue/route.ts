import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireEnterpriseFeature } from '@/lib/enterprise/guard'
import { getBroadcastQueue } from '@/lib/enterprise/queries'

export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireEnterpriseFeature(supabase, accountId, role, 'queue_engine')
    const queue = await getBroadcastQueue(supabase, accountId)
    return NextResponse.json({ queue })
  } catch (err) {
    return toErrorResponse(err)
  }
}
