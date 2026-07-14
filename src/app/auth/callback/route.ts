import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Exchanges the `code` from a Supabase auth email link (password
 * recovery, email confirmation, magic link) for a real session, then
 * redirects to `next` — e.g. /reset-password for the recovery flow.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
