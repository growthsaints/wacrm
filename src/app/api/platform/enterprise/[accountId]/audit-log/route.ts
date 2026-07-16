import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform'

/** GET /api/platform/enterprise/[accountId]/audit-log — recent
 *  feature-flag changes for one tenant, newest first. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { supabase } = await requirePlatformAdmin()
    const { accountId } = await params

    const { data: entries, error } = await supabase
      .from('enterprise_audit_log')
      .select('id, feature, previous_value, new_value, changed_by, ip_address, reason, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) {
      console.error('[GET /api/platform/enterprise/:id/audit-log] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load audit log' }, { status: 500 })
    }

    return NextResponse.json({ entries: entries ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
