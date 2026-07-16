import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireEnterpriseFeature } from '@/lib/enterprise/guard'
import { getAccountOverview } from '@/lib/enterprise/queries'

/** GET /api/enterprise/overview — Campaign Intelligence Overview tab. */
export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireEnterpriseFeature(supabase, accountId, role, 'campaign_intelligence')

    const overview = await getAccountOverview(supabase, accountId)
    return NextResponse.json({ overview })
  } catch (err) {
    return toErrorResponse(err)
  }
}
