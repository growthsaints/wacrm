import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { deleteCampaignPlan, updateCampaignPlan, type ChecklistItem } from '@/lib/business-workspace/queries'

/** PATCH /api/business-workspace/campaign-planner/[planId] — update status/checklist/draft/notes. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'campaign_planner')
    const { planId } = await params

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    await updateCampaignPlan(supabase, accountId, planId, {
      status: typeof body.status === 'string' ? body.status : undefined,
      checklist: Array.isArray(body.checklist) ? (body.checklist as ChecklistItem[]) : undefined,
      contentDraft: 'contentDraft' in body ? (body.contentDraft as string | null) : undefined,
      notes: 'notes' in body ? (body.notes as string | null) : undefined,
      mediaUrl: 'mediaUrl' in body ? (body.mediaUrl as string | null) : undefined,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/business-workspace/campaign-planner/[planId] */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'campaign_planner')
    const { planId } = await params

    await deleteCampaignPlan(supabase, accountId, planId)
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
