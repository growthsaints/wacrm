import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { startConnection } from '@/lib/whatsapp-personal/socket-manager'

/**
 * POST /api/business-workspace/whatsapp-personal/connect — starts a
 * connection attempt. Returns immediately; poll GET .../status for
 * the QR code and connection state as they update.
 */
export async function POST() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'whatsapp_personal_connect')

    await startConnection(accountId)
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
