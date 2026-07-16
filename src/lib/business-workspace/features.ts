import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountRole } from '@/lib/auth/roles'

// ============================================================
// Business Workspace licensing — an independent premium add-on
// (separate from the Campaign Intelligence Enterprise module) gated
// per-tenant by a Super-Admin-controlled license row (migration 046).
// Client-safe: no server-only imports here (see guard.ts for the
// API-route-only gate).
// ============================================================

export const BUSINESS_WORKSPACE_FEATURES = [
  'customer_hub',
  'customer_360',
  'shared_inbox',
  'team_workspace',
  'ai_assistant',
  'labels',
  'notes',
  'followup_center',
  'calendar',
  'deals',
  'campaign_planner',
  'analytics',
  'reports',
  'whatsapp_personal_connect',
] as const

export type BusinessWorkspaceFeature = (typeof BUSINESS_WORKSPACE_FEATURES)[number]

export type BusinessWorkspaceAccessType =
  | 'none'
  | 'permanent'
  | 'trial'
  | 'beta'
  | 'vip'
  | 'internal_team'
  | 'partner'
  | 'free'

export interface BusinessWorkspaceLicense {
  accountId: string
  workspaceEnabled: boolean
  features: Record<BusinessWorkspaceFeature, boolean>
  accessType: BusinessWorkspaceAccessType
  startDate: string | null
  expiryDate: string | null
  reason: string | null
  assignedBy: string | null
  notesAdmin: string | null
  createdAt: string
  updatedAt: string
}

interface BusinessWorkspaceLicenseRow {
  account_id: string
  workspace_enabled: boolean
  access_type: BusinessWorkspaceAccessType
  start_date: string | null
  expiry_date: string | null
  reason: string | null
  assigned_by: string | null
  notes_admin: string | null
  created_at: string
  updated_at: string
  [key: string]: unknown
}

function rowToLicense(row: BusinessWorkspaceLicenseRow): BusinessWorkspaceLicense {
  const features = Object.fromEntries(
    BUSINESS_WORKSPACE_FEATURES.map((f) => [f, Boolean(row[f])]),
  ) as Record<BusinessWorkspaceFeature, boolean>

  return {
    accountId: row.account_id,
    workspaceEnabled: row.workspace_enabled,
    features,
    accessType: row.access_type,
    startDate: row.start_date,
    expiryDate: row.expiry_date,
    reason: row.reason,
    assignedBy: row.assigned_by,
    notesAdmin: row.notes_admin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Null when the tenant has no license row at all (never granted access). */
export async function getBusinessWorkspaceLicense(
  supabase: SupabaseClient,
  accountId: string,
): Promise<BusinessWorkspaceLicense | null> {
  const { data, error } = await supabase
    .from('business_workspace_licenses')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data) return null
  return rowToLicense(data as BusinessWorkspaceLicenseRow)
}

/** A license is active only while enabled AND not past its expiry date. */
export function isLicenseActive(license: BusinessWorkspaceLicense | null): boolean {
  if (!license || !license.workspaceEnabled) return false
  if (!license.expiryDate) return true
  return new Date(license.expiryDate).getTime() > Date.now()
}

export function hasBusinessWorkspaceFeature(
  license: BusinessWorkspaceLicense | null,
  feature: BusinessWorkspaceFeature,
): boolean {
  return isLicenseActive(license) && Boolean(license?.features[feature])
}

/**
 * Role gate for the module itself — independent of the license.
 * Owner and Admin get access when the tenant's license is active;
 * Agent and Viewer never do (matching the Campaign Intelligence
 * Enterprise module's flat owner+admin gate).
 */
export function canAccessBusinessWorkspace(role: AccountRole): boolean {
  return role === 'owner' || role === 'admin'
}
