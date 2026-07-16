import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { deleteDepartment } from '@/lib/business-workspace/queries'

/** DELETE /api/business-workspace/departments/[departmentId] */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ departmentId: string }> },
) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'team_workspace')
    const { departmentId } = await params

    await deleteDepartment(supabase, accountId, departmentId)
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
