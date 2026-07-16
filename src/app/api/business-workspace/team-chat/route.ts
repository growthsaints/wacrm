import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { getInternalMessages, postInternalMessage } from '@/lib/business-workspace/queries'

/** GET /api/business-workspace/team-chat?department=<id> — omit for the General channel. */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'team_workspace')

    const url = new URL(request.url)
    const departmentId = url.searchParams.get('department')

    const messages = await getInternalMessages(supabase, accountId, departmentId)
    return NextResponse.json({ messages })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST /api/business-workspace/team-chat — Body: { departmentId, text } */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, role, userId } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'team_workspace')

    const body = (await request.json().catch(() => null)) as { departmentId?: unknown; text?: unknown } | null
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!text) return NextResponse.json({ error: 'Message text is required' }, { status: 400 })
    const departmentId = typeof body?.departmentId === 'string' ? body.departmentId : null

    await postInternalMessage(supabase, accountId, departmentId, userId, text)
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
