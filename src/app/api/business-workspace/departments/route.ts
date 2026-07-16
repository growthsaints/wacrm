import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { createDepartment, getDepartments } from '@/lib/business-workspace/queries'

/** GET /api/business-workspace/departments */
export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'team_workspace')

    const departments = await getDepartments(supabase, accountId)
    return NextResponse.json({ departments })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST /api/business-workspace/departments — Body: { name } */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, role, userId } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'team_workspace')

    const body = (await request.json().catch(() => null)) as { name?: unknown } | null
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'Department name is required' }, { status: 400 })

    const department = await createDepartment(supabase, accountId, userId, name)
    return NextResponse.json({ department })
  } catch (err) {
    return toErrorResponse(err)
  }
}
