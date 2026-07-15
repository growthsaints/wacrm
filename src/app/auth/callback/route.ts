import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBaseUrl } from '@/lib/http/base-url'

/**
 * Exchanges the `code` from a Supabase auth email link (password
 * recovery, email confirmation, magic link) for a real session, then
 * redirects to `next` — e.g. /reset-password for the recovery flow.
 *
 * The redirect target MUST be built from getBaseUrl(request), not
 * `new URL(request.url).origin` — behind a reverse proxy (CloudPanel/
 * nginx, Vercel, ...) that origin is wherever the Node process itself
 * is bound (e.g. http://localhost:3000), not the public domain the
 * browser used, so a plain-origin redirect sends the browser to an
 * unreachable internal address instead of the real site.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'
  const origin = getBaseUrl(request, 'auth/callback')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
