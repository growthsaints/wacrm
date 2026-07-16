import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { disconnectConnection } from '@/lib/whatsapp-personal/socket-manager'

/** POST /api/business-workspace/whatsapp-personal/disconnect — logs out and wipes the local session. */
export async function POST() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'whatsapp_personal_connect')

    await disconnectConnection(accountId)
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
