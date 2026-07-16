import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { platformAdminClient } from '@/lib/platform/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { BUSINESS_WORKSPACE_FEATURES } from '@/lib/business-workspace/features'

/**
 * POST /api/platform/business-workspace/[accountId]/clone
 * Body: { sourceAccountId: string }
 *
 * Copies another tenant's feature toggles (and workspace_enabled) onto
 * this tenant. Grant metadata (access type, expiry, reason, notes) is
 * deliberately NOT copied.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin()
    const { accountId } = await params

    const limit = checkRateLimit(
      `platform:business-workspace:clone:${ctx.userId}`,
      RATE_LIMITS.platformAdminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as { sourceAccountId?: unknown } | null
    const sourceAccountId = typeof body?.sourceAccountId === 'string' ? body.sourceAccountId : null
    if (!sourceAccountId) {
      return NextResponse.json({ error: "'sourceAccountId' is required" }, { status: 400 })
    }

    const admin = platformAdminClient()

    const { data: source, error: sourceErr } = await admin
      .from('business_workspace_licenses')
      .select('*')
      .eq('account_id', sourceAccountId)
      .maybeSingle()
    if (sourceErr || !source) {
      return NextResponse.json({ error: 'Source tenant has no license to clone' }, { status: 404 })
    }

    const { data: existing } = await admin
      .from('business_workspace_licenses')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()

    const featureUpdates = Object.fromEntries(BUSINESS_WORKSPACE_FEATURES.map((f) => [f, Boolean(source[f])]))
    const updates = {
      account_id: accountId,
      workspace_enabled: source.workspace_enabled,
      ...featureUpdates,
      assigned_by: ctx.userId,
    }

    const { data: saved, error: upsertErr } = await admin
      .from('business_workspace_licenses')
      .upsert(updates, { onConflict: 'account_id' })
      .select('*')
      .single()
    if (upsertErr) {
      console.error('[POST /api/platform/business-workspace/:id/clone] upsert error:', upsertErr)
      return NextResponse.json({ error: 'Failed to clone configuration' }, { status: 500 })
    }

    const auditRows = ['workspace_enabled', ...BUSINESS_WORKSPACE_FEATURES]
      .filter((key) => (existing?.[key] ?? false) !== (updates as Record<string, unknown>)[key])
      .map((key) => ({
        account_id: accountId,
        feature: key,
        previous_value: existing?.[key] === undefined || existing?.[key] === null ? null : String(existing[key]),
        new_value: String((updates as Record<string, unknown>)[key]),
        changed_by: ctx.userId,
        reason: `Cloned from tenant ${sourceAccountId}`,
      }))
    if (auditRows.length > 0) {
      await admin.from('business_workspace_audit_log').insert(auditRows)
    }

    return NextResponse.json({ license: saved })
  } catch (err) {
    return toErrorResponse(err)
  }
}
