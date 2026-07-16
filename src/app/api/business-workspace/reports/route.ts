import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { getWorkspaceReport, type ReportPeriod } from '@/lib/business-workspace/queries'

const PERIODS: ReportPeriod[] = ['daily', 'weekly', 'monthly']

/** GET /api/business-workspace/reports?period=daily|weekly|monthly */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'reports')

    const url = new URL(request.url)
    const periodParam = url.searchParams.get('period') ?? 'weekly'
    const period = PERIODS.includes(periodParam as ReportPeriod) ? (periodParam as ReportPeriod) : 'weekly'

    const report = await getWorkspaceReport(supabase, accountId, period)
    return NextResponse.json({ report })
  } catch (err) {
    return toErrorResponse(err)
  }
}
