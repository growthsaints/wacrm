import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Core feature licensing — Super-Admin-controlled per-tenant toggles
// for Broadcasts, Automations, and AI Agents (migration 057).
//
// Deliberately the mirror image of enterprise/features.ts's default:
// these three features are already freely usable by every existing
// account, so "no license row" means fully enabled here, not fully
// disabled. A row only needs to exist once a platform admin actually
// changes something for that tenant.
// ============================================================

export const CORE_FEATURES = ['broadcasts', 'automations', 'ai_agents'] as const

export type CoreFeature = (typeof CORE_FEATURES)[number]

export type CoreAccessType =
  | 'none'
  | 'permanent'
  | 'trial'
  | 'beta'
  | 'vip'
  | 'internal_team'
  | 'partner'
  | 'free'

export interface CoreFeatureLicense {
  accountId: string
  features: Record<CoreFeature, boolean>
  accessType: CoreAccessType
  startDate: string | null
  expiryDate: string | null
  reason: string | null
  assignedBy: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

interface CoreFeatureLicenseRow {
  account_id: string
  access_type: CoreAccessType
  start_date: string | null
  expiry_date: string | null
  reason: string | null
  assigned_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
  [key: string]: unknown
}

function rowToLicense(row: CoreFeatureLicenseRow): CoreFeatureLicense {
  const features = Object.fromEntries(
    CORE_FEATURES.map((f) => [f, Boolean(row[`${f}_enabled`])]),
  ) as Record<CoreFeature, boolean>

  return {
    accountId: row.account_id,
    features,
    accessType: row.access_type,
    startDate: row.start_date,
    expiryDate: row.expiry_date,
    reason: row.reason,
    assignedBy: row.assigned_by,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Null when the tenant has no license row — which means "fully
 *  enabled, never restricted" for this module (see hasCoreFeature). */
export async function getCoreFeatureLicense(
  supabase: SupabaseClient,
  accountId: string,
): Promise<CoreFeatureLicense | null> {
  const { data, error } = await supabase
    .from('core_feature_licenses')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data) return null
  return rowToLicense(data as CoreFeatureLicenseRow)
}

/** An explicit grant with an expiry_date lapses once that date passes
 *  (mirrors enterprise's isLicenseActive) — a permanent grant (no
 *  expiry) or the "no row at all" default never does. */
function isLicenseExpired(license: CoreFeatureLicense): boolean {
  if (!license.expiryDate) return false
  return new Date(license.expiryDate).getTime() <= Date.now()
}

/**
 * No row at all → true (default-on, matches current live behaviour
 * for every account that's never had this touched). A row exists →
 * the feature's own boolean, unless the grant has expired.
 */
export function hasCoreFeature(
  license: CoreFeatureLicense | null,
  feature: CoreFeature,
): boolean {
  if (!license) return true
  if (isLicenseExpired(license)) return false
  return license.features[feature]
}
