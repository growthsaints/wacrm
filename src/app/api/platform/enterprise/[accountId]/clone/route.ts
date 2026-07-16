import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { platformAdminClient } from '@/lib/platform/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { ENTERPRISE_FEATURES } from '@/lib/enterprise/features'

/**
 * POST /api/platform/enterprise/[accountId]/clone
 * Body: { sourceAccountId: string }
 *
 * Copies another tenant's feature toggles (and enterprise_enabled)
 * onto this tenant — "Clone Feature Configuration" / "Apply Feature
 * Configuration" from the spec. Grant metadata (access type, expiry,
 * reason, notes) is deliberately NOT copied — cloning a configuration
 * shouldn't silently inherit someone else's trial expiry or free-
 * access reason.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin()
    const { accountId } = await params

    const limit = checkRateLimit(
      `platform:enterprise:clone:${ctx.userId}`,
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
      .from('enterprise_licenses')
      .select('*')
      .eq('account_id', sourceAccountId)
      .maybeSingle()
    if (sourceErr || !source) {
      return NextResponse.json({ error: 'Source tenant has no license to clone' }, { status: 404 })
    }

    const { data: existing } = await admin
      .from('enterprise_licenses')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()

    const featureUpdates = Object.fromEntries(ENTERPRISE_FEATURES.map((f) => [f, Boolean(source[f])]))
    const updates = {
      account_id: accountId,
      enterprise_enabled: source.enterprise_enabled,
      ...featureUpdates,
      assigned_by: ctx.userId,
    }

    const { data: saved, error: upsertErr } = await admin
      .from('enterprise_licenses')
      .upsert(updates, { onConflict: 'account_id' })
      .select('*')
      .single()
    if (upsertErr) {
      console.error('[POST /api/platform/enterprise/:id/clone] upsert error:', upsertErr)
      return NextResponse.json({ error: 'Failed to clone configuration' }, { status: 500 })
    }

    const auditRows = ['enterprise_enabled', ...ENTERPRISE_FEATURES]
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
      await admin.from('enterprise_audit_log').insert(auditRows)
    }

    return NextResponse.json({ license: saved })
  } catch (err) {
    return toErrorResponse(err)
  }
}
