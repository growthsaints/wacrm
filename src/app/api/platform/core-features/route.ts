import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { CORE_FEATURES } from '@/lib/core-features/features'

/**
 * GET /api/platform/core-features — every tenant plus its core-feature
 * license (if any), for the "Core Feature Manager" table. Tenants with
 * no license row show every feature as true/enabled — see
 * src/lib/core-features/features.ts on why the default here is the
 * opposite of the Enterprise manager's.
 */
export async function GET() {
  try {
    const { supabase } = await requirePlatformAdmin()

    const { data: accounts, error: accountsErr } = await supabase
      .from('accounts')
      .select('id, name, plan_type, plan_status, status, created_at')
      .order('created_at', { ascending: false })
    if (accountsErr) {
      console.error('[GET /api/platform/core-features] accounts fetch error:', accountsErr)
      return NextResponse.json({ error: 'Failed to load tenants' }, { status: 500 })
    }

    const { data: licenses, error: licensesErr } = await supabase
      .from('core_feature_licenses')
      .select('*')
    if (licensesErr) {
      console.error('[GET /api/platform/core-features] licenses fetch error:', licensesErr)
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
        accessType: license?.access_type ?? 'permanent',
        expiryDate: license?.expiry_date ?? null,
        features: Object.fromEntries(
          CORE_FEATURES.map((f) => [f, license ? Boolean(license[`${f}_enabled`]) : true]),
        ),
      }
    })

    return NextResponse.json({ tenants })
  } catch (err) {
    return toErrorResponse(err)
  }
}
