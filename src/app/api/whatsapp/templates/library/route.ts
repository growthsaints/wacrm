import { NextResponse } from 'next/server'
import { requireFeature, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  submitLibraryTemplate,
  type LibraryButtonInput,
  type LibraryBodyInputs,
} from '@/lib/whatsapp/meta-api'
import { validateTemplateName } from '@/lib/whatsapp/template-validators'
import { syncTemplatesFromMeta } from '@/lib/whatsapp/template-sync'

interface LibraryCreateBody {
  name: string
  category: string
  language: string
  library_template_name: string
  library_template_button_inputs?: LibraryButtonInput[]
  library_template_body_inputs?: LibraryBodyInputs
}

const VALID_CATEGORIES = new Set(['MARKETING', 'UTILITY', 'AUTHENTICATION'])

/**
 * POST /api/whatsapp/templates/library
 *
 * Create a template from the Template Library by its exact name (the
 * user finds this in WhatsApp Manager's own Template Library UI —
 * Meta's documented browse endpoint doesn't return results on real
 * WABAs, see meta-api.ts). Meta approves these immediately, but we
 * still run the normal Meta -> local sync afterward so the row's
 * body/header/buttons text matches exactly what Meta stored, instead
 * of us reconstructing it ourselves.
 */
export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireFeature>>
  try {
    ctx = await requireFeature('templates')
  } catch (err) {
    return toErrorResponse(err)
  }
  const { supabase, accountId, userId } = ctx

  try {
    let body: LibraryCreateBody
    try {
      body = (await request.json()) as LibraryCreateBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    if (!body.library_template_name?.trim()) {
      return NextResponse.json(
        { error: 'library_template_name is required.' },
        { status: 400 },
      )
    }
    if (!VALID_CATEGORIES.has(body.category)) {
      return NextResponse.json(
        { error: 'category must be MARKETING, UTILITY, or AUTHENTICATION.' },
        { status: 400 },
      )
    }
    try {
      validateTemplateName(body.name)
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Invalid name.' },
        { status: 400 },
      )
    }
    if (!body.language?.trim()) {
      return NextResponse.json({ error: 'Language is required.' }, { status: 400 })
    }

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
    const name = body.name.trim()
    const language = body.language.trim()

    let metaTemplateId: string
    try {
      const meta = await submitLibraryTemplate({
        wabaId: config.waba_id,
        accessToken,
        name,
        category: body.category as 'MARKETING' | 'UTILITY' | 'AUTHENTICATION',
        language,
        libraryTemplateName: body.library_template_name.trim(),
        buttonInputs: body.library_template_button_inputs,
        bodyInputs: body.library_template_body_inputs,
      })
      metaTemplateId = meta.id
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Meta rejected the library template.'
      const isRateLimit = /\b429\b/.test(message)
      return NextResponse.json(
        {
          error: isRateLimit
            ? 'Meta rate limit hit (100 template creates per hour). Try again later.'
            : message,
        },
        { status: isRateLimit ? 429 : 502 },
      )
    }

    // Meta created the template on their side. Pull the authoritative
    // content back down rather than reconstructing it locally.
    await syncTemplatesFromMeta({
      supabase,
      accountId,
      userId,
      wabaId: config.waba_id,
      accessToken,
    })

    const { data: row } = await supabase
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', name)
      .eq('language', language)
      .maybeSingle()

    return NextResponse.json({ success: true, template: row, meta_template_id: metaTemplateId })
  } catch (error) {
    console.error('Error creating library template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to create library template.',
      },
      { status: 500 },
    )
  }
}
