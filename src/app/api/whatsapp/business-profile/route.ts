import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  getBusinessProfile,
  updateBusinessProfile,
  uploadResumableMedia,
  type BusinessProfileVertical,
} from '@/lib/whatsapp/meta-api'

const VERTICALS: readonly BusinessProfileVertical[] = [
  'UNDEFINED', 'OTHER', 'AUTO', 'BEAUTY', 'APPAREL', 'EDU', 'ENTERTAIN',
  'EVENT_PLAN', 'FINANCE', 'GROCERY', 'GOVT', 'HOTEL', 'HEALTH', 'NONPROFIT',
  'PROF_SERVICES', 'RETAIL', 'TRAVEL', 'RESTAURANT', 'NOT_A_BIZ',
]
function isVertical(v: unknown): v is BusinessProfileVertical {
  return typeof v === 'string' && (VERTICALS as readonly string[]).includes(v)
}

async function loadPhoneAndToken(accountId: string, supabase: Awaited<ReturnType<typeof requireRole>>['supabase']) {
  const { data, error } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data?.phone_number_id || !data?.access_token) return null
  return {
    phoneNumberId: data.phone_number_id as string,
    accessToken: decrypt(data.access_token as string),
  }
}

/** GET /api/whatsapp/business-profile (agent+) — the customer-facing
 *  About/description/address/photo shown on the connected number. */
export async function GET() {
  try {
    const { accountId, supabase } = await requireRole('agent')
    const conn = await loadPhoneAndToken(accountId, supabase)
    if (!conn) {
      return NextResponse.json(
        { error: 'Connect a WhatsApp number first.', code: 'not_connected' },
        { status: 400 },
      )
    }
    const profile = await getBusinessProfile(conn)
    return NextResponse.json({ profile })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST /api/whatsapp/business-profile (admin+) — update the profile.
 *  Accepts multipart form data: text fields (about/address/description/
 *  email/vertical/websites — websites as repeated `websites` entries or
 *  a JSON array string) plus an optional `photo` file. */
export async function POST(request: Request) {
  try {
    const { accountId, supabase } = await requireRole('admin')
    const conn = await loadPhoneAndToken(accountId, supabase)
    if (!conn) {
      return NextResponse.json(
        { error: 'Connect a WhatsApp number first.', code: 'not_connected' },
        { status: 400 },
      )
    }

    const form = await request.formData()
    const about = form.get('about')
    const address = form.get('address')
    const description = form.get('description')
    const email = form.get('email')
    const verticalRaw = form.get('vertical')
    const websitesRaw = form.get('websites')
    const photo = form.get('photo')

    let websites: string[] | undefined
    if (typeof websitesRaw === 'string' && websitesRaw.trim()) {
      try {
        const parsed = JSON.parse(websitesRaw)
        if (Array.isArray(parsed)) websites = parsed.filter((w) => typeof w === 'string' && w.trim())
      } catch {
        websites = [websitesRaw.trim()]
      }
    }

    let profilePictureHandle: string | undefined
    if (photo instanceof File && photo.size > 0) {
      const appId = process.env.META_APP_ID
      if (!appId) {
        return NextResponse.json(
          { error: 'META_APP_ID is not configured — cannot upload a photo.' },
          { status: 400 },
        )
      }
      if (photo.size > 5 * 1024 * 1024) {
        return NextResponse.json({ error: 'Photo must be under 5 MB.' }, { status: 400 })
      }
      const bytes = new Uint8Array(await photo.arrayBuffer())
      const { handle } = await uploadResumableMedia({
        appId,
        accessToken: conn.accessToken,
        fileName: photo.name || 'profile.jpg',
        mimeType: photo.type || 'image/jpeg',
        bytes,
      })
      profilePictureHandle = handle
    }

    await updateBusinessProfile({
      ...conn,
      about: typeof about === 'string' ? about : undefined,
      address: typeof address === 'string' ? address : undefined,
      description: typeof description === 'string' ? description : undefined,
      email: typeof email === 'string' ? email : undefined,
      vertical: isVertical(verticalRaw) ? verticalRaw : undefined,
      websites,
      profilePictureHandle,
    })

    const profile = await getBusinessProfile(conn)
    return NextResponse.json({ profile })
  } catch (err) {
    return toErrorResponse(err)
  }
}
