import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { getConnectionState } from '@/lib/whatsapp-personal/socket-manager'

/** GET /api/business-workspace/whatsapp-personal/status — current connection status + QR if pending. */
export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'whatsapp_personal_connect')

    const state = getConnectionState(accountId)
    return NextResponse.json(state)
  } catch (err) {
    return toErrorResponse(err)
  }
}
