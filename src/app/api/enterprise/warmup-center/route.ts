import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireEnterpriseFeature } from '@/lib/enterprise/guard'
import { getWarmupCenter } from '@/lib/enterprise/queries'

export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireEnterpriseFeature(supabase, accountId, role, 'warmup_center')
    const warmup = await getWarmupCenter(supabase, accountId)
    return NextResponse.json({ warmup })
  } catch (err) {
    return toErrorResponse(err)
  }
}
