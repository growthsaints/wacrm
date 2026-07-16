import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireEnterpriseFeature } from '@/lib/enterprise/guard'
import { getContactIntelligence } from '@/lib/enterprise/queries'

export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireEnterpriseFeature(supabase, accountId, role, 'campaign_intelligence')
    const contacts = await getContactIntelligence(supabase, accountId)
    return NextResponse.json({ contacts })
  } catch (err) {
    return toErrorResponse(err)
  }
}
