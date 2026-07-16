import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireEnterpriseFeature } from '@/lib/enterprise/guard'
import { getAccountHealth } from '@/lib/enterprise/queries'

/** GET /api/enterprise/account-health — Account Health tab. */
export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireEnterpriseFeature(supabase, accountId, role, 'account_health')

    const health = await getAccountHealth(supabase, accountId)
    return NextResponse.json({ health })
  } catch (err) {
    return toErrorResponse(err)
  }
}
