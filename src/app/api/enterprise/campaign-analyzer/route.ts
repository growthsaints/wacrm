import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireEnterpriseFeature } from '@/lib/enterprise/guard'
import { analyzeCampaign } from '@/lib/enterprise/queries'

/** GET /api/enterprise/campaign-analyzer?template=NAME&language=en_US */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireEnterpriseFeature(supabase, accountId, role, 'campaign_intelligence')

    const { searchParams } = new URL(request.url)
    const template = searchParams.get('template')
    const language = searchParams.get('language') ?? 'en_US'
    if (!template) {
      return NextResponse.json({ error: "'template' query param is required" }, { status: 400 })
    }

    const analysis = await analyzeCampaign(supabase, accountId, template, language)
    if (!analysis) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }
    return NextResponse.json({ analysis })
  } catch (err) {
    return toErrorResponse(err)
  }
}
