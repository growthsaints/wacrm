import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireEnterpriseFeature } from '@/lib/enterprise/guard'
import { getDeliveryInsights } from '@/lib/enterprise/queries'

/** GET /api/enterprise/delivery-insights — Delivery Insights tab. */
export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireEnterpriseFeature(supabase, accountId, role, 'delivery_insights')

    const insights = await getDeliveryInsights(supabase, accountId)
    return NextResponse.json({ insights })
  } catch (err) {
    return toErrorResponse(err)
  }
}
