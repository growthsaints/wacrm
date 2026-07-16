import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountRole } from '@/lib/auth/roles'

// ============================================================
// Enterprise module licensing — "Campaign Intelligence & Account
// Health Center" is an independent add-on gated per-tenant by a
// Super-Admin-controlled license row (migration 044). Nothing in
// this file assumes the module's own pages/data exist yet — this is
// the foundation other phases build on.
// ============================================================

export const ENTERPRISE_FEATURES = [
  'campaign_intelligence',
  'account_health',
  'delivery_insights',
  'queue_engine',
  'warmup_center',
  'template_intelligence',
  'ai_recommendations',
  'risk_center',
  'compliance_center',
  'automation_rules',
] as const

export type EnterpriseFeature = (typeof ENTERPRISE_FEATURES)[number]

export type EnterpriseAccessType =
  | 'none'
  | 'permanent'
  | 'trial'
  | 'beta'
  | 'vip'
  | 'internal_team'
  | 'partner'
  | 'free'

export interface EnterpriseLicense {
  accountId: string
  enterpriseEnabled: boolean
  features: Record<EnterpriseFeature, boolean>
  accessType: EnterpriseAccessType
  startDate: string | null
  expiryDate: string | null
  reason: string | null
  assignedBy: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

interface EnterpriseLicenseRow {
  account_id: string
  enterprise_enabled: boolean
  access_type: EnterpriseAccessType
  start_date: string | null
  expiry_date: string | null
  reason: string | null
  assigned_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
  [key: string]: unknown
}

function rowToLicense(row: EnterpriseLicenseRow): EnterpriseLicense {
  const features = Object.fromEntries(
    ENTERPRISE_FEATURES.map((f) => [f, Boolean(row[f])]),
  ) as Record<EnterpriseFeature, boolean>

  return {
    accountId: row.account_id,
    enterpriseEnabled: row.enterprise_enabled,
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

/** Null when the tenant has no license row at all (never granted access). */
export async function getEnterpriseLicense(
  supabase: SupabaseClient,
  accountId: string,
): Promise<EnterpriseLicense | null> {
  const { data, error } = await supabase
    .from('enterprise_licenses')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data) return null
  return rowToLicense(data as EnterpriseLicenseRow)
}

/** A license is active only while enabled AND not past its expiry date
 *  (a null expiry_date means "no expiry" — permanent grants use this). */
export function isLicenseActive(license: EnterpriseLicense | null): boolean {
  if (!license || !license.enterpriseEnabled) return false
  if (!license.expiryDate) return true
  return new Date(license.expiryDate).getTime() > Date.now()
}

export function hasEnterpriseFeature(
  license: EnterpriseLicense | null,
  feature: EnterpriseFeature,
): boolean {
  return isLicenseActive(license) && Boolean(license?.features[feature])
}

/**
 * Role gate for the module itself — independent of the license.
 * Owner and Admin get access when the tenant's license is active;
 * Agent and Viewer never do, regardless of license state. (A future
 * phase can add a per-user override, mirroring agent_feature_grants,
 * for the "Admin: no access by default, enable manually" nuance the
 * spec calls out — this phase keeps the role gate a flat owner+admin
 * check to stay a shippable foundation.)
 */
export function canAccessEnterpriseModule(role: AccountRole): boolean {
  return role === 'owner' || role === 'admin'
}
