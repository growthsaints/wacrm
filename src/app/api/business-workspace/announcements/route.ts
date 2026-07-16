import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { createAnnouncement, getAnnouncements } from '@/lib/business-workspace/queries'

/** GET /api/business-workspace/announcements */
export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'team_workspace')

    const announcements = await getAnnouncements(supabase, accountId)
    return NextResponse.json({ announcements })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST /api/business-workspace/announcements — Body: { title, contentText }. RLS restricts writes to admin+. */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, role, userId } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'team_workspace')

    const body = (await request.json().catch(() => null)) as { title?: unknown; contentText?: unknown } | null
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const contentText = typeof body?.contentText === 'string' ? body.contentText.trim() : ''
    if (!title || !contentText) return NextResponse.json({ error: 'Title and content are required' }, { status: 400 })

    const announcement = await createAnnouncement(supabase, accountId, userId, title, contentText)
    return NextResponse.json({ announcement })
  } catch (err) {
    return toErrorResponse(err)
  }
}
