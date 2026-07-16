import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { BUSINESS_WORKSPACE_FEATURES } from '@/lib/business-workspace/features'

/**
 * GET /api/platform/business-workspace — every tenant plus its
 * Business Workspace license (if any), for the tenant list table.
 * Tenants with no license row yet show every feature as false —
 * they simply haven't been granted anything.
 */
export async function GET() {
  try {
    const { supabase } = await requirePlatformAdmin()

    const { data: accounts, error: accountsErr } = await supabase
      .from('accounts')
      .select('id, name, plan_type, plan_status, status, created_at')
      .order('created_at', { ascending: false })
    if (accountsErr) {
      console.error('[GET /api/platform/business-workspace] accounts fetch error:', accountsErr)
      return NextResponse.json({ error: 'Failed to load tenants' }, { status: 500 })
    }

    const { data: licenses, error: licensesErr } = await supabase
      .from('business_workspace_licenses')
      .select('*')
    if (licensesErr) {
      console.error('[GET /api/platform/business-workspace] licenses fetch error:', licensesErr)
      return NextResponse.json({ error: 'Failed to load licenses' }, { status: 500 })
    }

    const licenseByAccount = new Map((licenses ?? []).map((l) => [l.account_id as string, l]))

    const tenants = (accounts ?? []).map((account) => {
      const license = licenseByAccount.get(account.id)
      return {
        accountId: account.id,
        companyName: account.name,
        planType: account.plan_type,
        planStatus: account.plan_status,
        status: account.status,
        createdAt: account.created_at,
        workspaceEnabled: license?.workspace_enabled ?? false,
        accessType: license?.access_type ?? 'none',
        expiryDate: license?.expiry_date ?? null,
        features: Object.fromEntries(
          BUSINESS_WORKSPACE_FEATURES.map((f) => [f, Boolean(license?.[f])]),
        ),
      }
    })

    return NextResponse.json({ tenants })
  } catch (err) {
    return toErrorResponse(err)
  }
}
