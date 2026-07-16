import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireEnterpriseFeature } from '@/lib/enterprise/guard'
import { getRiskCenter } from '@/lib/enterprise/queries'

export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireEnterpriseFeature(supabase, accountId, role, 'risk_center')
    const risk = await getRiskCenter(supabase, accountId)
    return NextResponse.json({ risk })
  } catch (err) {
    return toErrorResponse(err)
  }
}
