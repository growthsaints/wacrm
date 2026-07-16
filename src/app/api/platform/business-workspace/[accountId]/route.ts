import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { platformAdminClient } from '@/lib/platform/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { BUSINESS_WORKSPACE_FEATURES, type BusinessWorkspaceAccessType } from '@/lib/business-workspace/features'

const ACCESS_TYPES: readonly BusinessWorkspaceAccessType[] = [
  'none', 'permanent', 'trial', 'beta', 'vip', 'internal_team', 'partner', 'free',
]

function getClientIp(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  return xri ? xri.trim() : null
}

/** GET /api/platform/business-workspace/[accountId] — one tenant's license row. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { supabase } = await requirePlatformAdmin()
    const { accountId } = await params

    const { data: license } = await supabase
      .from('business_workspace_licenses')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()

    return NextResponse.json({ license: license ?? null })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/platform/business-workspace/[accountId] — create-or-update
 * a tenant's license. Every changed field gets its own
 * business_workspace_audit_log row, mirroring the Enterprise module's
 * field-level audit trail.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin()
    const { accountId } = await params

    const limit = checkRateLimit(
      `platform:business-workspace:${ctx.userId}`,
      RATE_LIMITS.platformAdminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const admin = platformAdminClient()

    const { data: existing } = await admin
      .from('business_workspace_licenses')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()

    const updates: Record<string, unknown> = {}

    if (typeof body.workspaceEnabled === 'boolean') {
      updates.workspace_enabled = body.workspaceEnabled
    }
    for (const feature of BUSINESS_WORKSPACE_FEATURES) {
      if (typeof body[feature] === 'boolean') updates[feature] = body[feature]
    }
    if (typeof body.accessType === 'string' && ACCESS_TYPES.includes(body.accessType as BusinessWorkspaceAccessType)) {
      updates.access_type = body.accessType
    }
    if (body.startDate === null || typeof body.startDate === 'string') updates.start_date = body.startDate
    if (body.expiryDate === null || typeof body.expiryDate === 'string') updates.expiry_date = body.expiryDate
    if (body.reason === null || typeof body.reason === 'string') updates.reason = body.reason
    if (body.notes === null || typeof body.notes === 'string') updates.notes_admin = body.notes

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    updates.assigned_by = ctx.userId

    const { data: saved, error: upsertErr } = await admin
      .from('business_workspace_licenses')
      .upsert({ account_id: accountId, ...updates }, { onConflict: 'account_id' })
      .select('*')
      .single()
    if (upsertErr) {
      console.error('[PATCH /api/platform/business-workspace/:id] upsert error:', upsertErr)
      return NextResponse.json({ error: 'Failed to update license' }, { status: 500 })
    }

    const ip = getClientIp(request)
    const reasonForLog = typeof body.reason === 'string' ? body.reason : null
    const auditRows = Object.keys(updates)
      .filter((key) => key !== 'assigned_by')
      .filter((key) => (existing?.[key] ?? null) !== (updates[key] ?? null))
      .map((key) => ({
        account_id: accountId,
        feature: key,
        previous_value: existing?.[key] === undefined || existing?.[key] === null ? null : String(existing[key]),
        new_value: updates[key] === undefined || updates[key] === null ? null : String(updates[key]),
        changed_by: ctx.userId,
        ip_address: ip,
        reason: reasonForLog,
      }))
    if (auditRows.length > 0) {
      const { error: auditErr } = await admin.from('business_workspace_audit_log').insert(auditRows)
      if (auditErr) console.error('[PATCH /api/platform/business-workspace/:id] audit log insert error:', auditErr)
    }

    return NextResponse.json({ license: saved })
  } catch (err) {
    return toErrorResponse(err)
  }
}
