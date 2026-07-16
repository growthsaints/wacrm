import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { platformAdminClient } from '@/lib/platform/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { ENTERPRISE_FEATURES, type EnterpriseAccessType } from '@/lib/enterprise/features'

const ACCESS_TYPES: readonly EnterpriseAccessType[] = [
  'none', 'permanent', 'trial', 'beta', 'vip', 'internal_team', 'partner', 'free',
]

function getClientIp(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  return xri ? xri.trim() : null
}

/** GET /api/platform/enterprise/[accountId] — one tenant's license row. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { supabase } = await requirePlatformAdmin()
    const { accountId } = await params

    const { data: license } = await supabase
      .from('enterprise_licenses')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()

    return NextResponse.json({ license: license ?? null })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/platform/enterprise/[accountId] — create-or-update a
 * tenant's license. Every changed field (master switch, each feature,
 * access type/expiry/reason/notes) gets its own enterprise_audit_log
 * row, so the audit trail reads as a field-level diff, not a single
 * opaque "license updated" entry.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin()
    const { accountId } = await params

    const limit = checkRateLimit(
      `platform:enterprise:${ctx.userId}`,
      RATE_LIMITS.platformAdminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const admin = platformAdminClient()

    const { data: existing } = await admin
      .from('enterprise_licenses')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()

    const updates: Record<string, unknown> = {}

    if (typeof body.enterpriseEnabled === 'boolean') {
      updates.enterprise_enabled = body.enterpriseEnabled
    }
    for (const feature of ENTERPRISE_FEATURES) {
      if (typeof body[feature] === 'boolean') updates[feature] = body[feature]
    }
    if (typeof body.accessType === 'string' && ACCESS_TYPES.includes(body.accessType as EnterpriseAccessType)) {
      updates.access_type = body.accessType
    }
    if (body.startDate === null || typeof body.startDate === 'string') updates.start_date = body.startDate
    if (body.expiryDate === null || typeof body.expiryDate === 'string') updates.expiry_date = body.expiryDate
    if (body.reason === null || typeof body.reason === 'string') updates.reason = body.reason
    if (body.notes === null || typeof body.notes === 'string') updates.notes = body.notes

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    updates.assigned_by = ctx.userId

    const { data: saved, error: upsertErr } = await admin
      .from('enterprise_licenses')
      .upsert({ account_id: accountId, ...updates }, { onConflict: 'account_id' })
      .select('*')
      .single()
    if (upsertErr) {
      console.error('[PATCH /api/platform/enterprise/:id] upsert error:', upsertErr)
      return NextResponse.json({ error: 'Failed to update license' }, { status: 500 })
    }

    // Field-level audit trail — one row per changed field, diffed
    // against whatever the row held before this call.
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
      const { error: auditErr } = await admin.from('enterprise_audit_log').insert(auditRows)
      if (auditErr) console.error('[PATCH /api/platform/enterprise/:id] audit log insert error:', auditErr)
    }

    return NextResponse.json({ license: saved })
  } catch (err) {
    return toErrorResponse(err)
  }
}
