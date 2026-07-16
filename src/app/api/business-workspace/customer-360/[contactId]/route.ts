import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { addContactNote, getCustomerProfile } from '@/lib/business-workspace/queries'

/** GET /api/business-workspace/customer-360/[contactId] — full customer profile. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ contactId: string }> },
) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'customer_360')
    const { contactId } = await params

    const profile = await getCustomerProfile(supabase, accountId, contactId)
    if (!profile) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    return NextResponse.json({ profile })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST /api/business-workspace/customer-360/[contactId] — add a note. Body: { noteText } */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ contactId: string }> },
) {
  try {
    const { supabase, accountId, role, userId } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'customer_360')
    const { contactId } = await params

    const body = (await request.json().catch(() => null)) as { noteText?: unknown } | null
    const noteText = typeof body?.noteText === 'string' ? body.noteText.trim() : ''
    if (!noteText) return NextResponse.json({ error: 'Note text is required' }, { status: 400 })

    const note = await addContactNote(supabase, accountId, userId, contactId, noteText)
    return NextResponse.json({ note })
  } catch (err) {
    return toErrorResponse(err)
  }
}
