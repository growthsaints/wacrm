import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { addDepartmentMember, removeDepartmentMember } from '@/lib/business-workspace/queries'

/** POST /api/business-workspace/departments/[departmentId]/members — Body: { userId } */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ departmentId: string }> },
) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'team_workspace')
    const { departmentId } = await params

    const body = (await request.json().catch(() => null)) as { userId?: unknown } | null
    const memberUserId = typeof body?.userId === 'string' ? body.userId : ''
    if (!memberUserId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

    await addDepartmentMember(supabase, departmentId, memberUserId)
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/business-workspace/departments/[departmentId]/members — Body: { userId } */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ departmentId: string }> },
) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'team_workspace')
    const { departmentId } = await params

    const body = (await request.json().catch(() => null)) as { userId?: unknown } | null
    const memberUserId = typeof body?.userId === 'string' ? body.userId : ''
    if (!memberUserId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

    await removeDepartmentMember(supabase, departmentId, memberUserId)
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
