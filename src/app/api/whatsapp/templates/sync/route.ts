import { NextResponse } from 'next/server'
import { requireFeature, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { syncTemplatesFromMeta } from '@/lib/whatsapp/template-sync'

/**
 * POST /api/whatsapp/templates/sync
 *
 * Manual "Sync from Meta" button — pulls every template from the
 * account's connected WABA into `message_templates`. The actual sync
 * logic lives in `@/lib/whatsapp/template-sync` so this route and the
 * automatic post-Embedded-Signup setup
 * (embedded-signup/complete/route.ts) share one implementation.
 */
export async function POST() {
  let ctx: Awaited<ReturnType<typeof requireFeature>>
  try {
    ctx = await requireFeature('templates')
  } catch (err) {
    return toErrorResponse(err)
  }
  const { supabase, accountId, userId } = ctx

  try {
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
        },
        { status: 400 },
      )
    }

    if (!config.waba_id) {
      return NextResponse.json(
        {
          error:
            'WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.',
        },
        { status: 400 },
      )
    }

    const accessToken = decrypt(config.access_token)

    const result = await syncTemplatesFromMeta({
      supabase,
      accountId,
      userId,
      wabaId: config.waba_id,
      accessToken,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error syncing WhatsApp templates:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to sync templates',
      },
      { status: 500 },
    )
  }
}
