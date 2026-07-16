import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireEnterpriseFeature } from '@/lib/enterprise/guard'
import { getComplianceCenter } from '@/lib/enterprise/queries'

export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireEnterpriseFeature(supabase, accountId, role, 'compliance_center')
    const compliance = await getComplianceCenter(supabase, accountId)
    return NextResponse.json({ compliance })
  } catch (err) {
    return toErrorResponse(err)
  }
}
