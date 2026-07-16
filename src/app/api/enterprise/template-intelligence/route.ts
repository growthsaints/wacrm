import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireEnterpriseFeature } from '@/lib/enterprise/guard'
import { getTemplateIntelligence } from '@/lib/enterprise/queries'

export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireEnterpriseFeature(supabase, accountId, role, 'template_intelligence')
    const templates = await getTemplateIntelligence(supabase, accountId)
    return NextResponse.json({ templates })
  } catch (err) {
    return toErrorResponse(err)
  }
}
