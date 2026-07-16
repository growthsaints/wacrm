import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { createCampaignPlan, getCampaignPlans } from '@/lib/business-workspace/queries'

/** GET /api/business-workspace/campaign-planner — planning-only campaign drafts. */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'campaign_planner')

    const url = new URL(request.url)
    const result = await getCampaignPlans(supabase, accountId, { status: url.searchParams.get('status') || undefined })
    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST /api/business-workspace/campaign-planner — create a new plan (draft only, never sends anything). */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, role, userId } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'campaign_planner')

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

    const plan = await createCampaignPlan(supabase, accountId, userId, {
      name,
      audienceSegment: typeof body?.audienceSegment === 'string' ? body.audienceSegment : null,
      contentDraft: typeof body?.contentDraft === 'string' ? body.contentDraft : null,
      planningDate: typeof body?.planningDate === 'string' ? body.planningDate : null,
    })

    return NextResponse.json({ plan })
  } catch (err) {
    return toErrorResponse(err)
  }
}
