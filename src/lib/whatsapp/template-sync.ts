// ============================================================
// Template sync — Meta → local message_templates, extracted so both
// the manual "Sync from Meta" button (templates/sync/route.ts) and
// the automatic post-Embedded-Signup setup
// (embedded-signup/complete/route.ts) call one implementation instead
// of two copies drifting apart.
//
// The local catalog stores Meta's status enum verbatim (APPROVED /
// PENDING / REJECTED / PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION)
// so the edit / resubmit / delete flows can distinguish recoverable
// states (PAUSED) from terminal ones (DISABLED) and so webhook events
// land 1:1 without a translation table.
//
// Locally-created templates (no Meta counterpart) are NOT deleted —
// they remain visible so the user can notice drift and clean up.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'
import type { TemplateButton, TemplateCard, TemplateSampleValues } from '@/types'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaButton {
  type: string
  text: string
  url?: string
  phone_number?: string
  example?: string[] | string
}

interface MetaTemplateComponent {
  type: string
  text?: string
  format?: string
  buttons?: MetaButton[]
  example?: {
    header_text?: string[]
    header_handle?: string[]
    header_url?: string[]
    body_text?: string[][]
  }
  /** Only on a CAROUSEL component. */
  cards?: { components: MetaTemplateComponent[] }[]
}

interface MetaTemplate {
  id: string
  name: string
  language: string
  status: string
  category: string
  components?: MetaTemplateComponent[]
  quality_score?: { score?: string } | string
}

export interface TemplateSyncResult {
  success: boolean
  total: number
  inserted: number
  updated: number
  errors: { name: string; language: string; message: string }[]
  truncated: boolean
}

function normalizeCategory(meta: string): 'Marketing' | 'Utility' | 'Authentication' {
  const upper = meta.toUpperCase()
  if (upper === 'UTILITY') return 'Utility'
  if (upper === 'AUTHENTICATION') return 'Authentication'
  return 'Marketing'
}

function normalizeQualityScore(
  raw: MetaTemplate['quality_score'],
): 'GREEN' | 'YELLOW' | 'RED' | null {
  const score = typeof raw === 'string' ? raw : raw?.score ? String(raw.score) : null
  if (!score) return null
  const upper = score.toUpperCase()
  return upper === 'GREEN' || upper === 'YELLOW' || upper === 'RED'
    ? (upper as 'GREEN' | 'YELLOW' | 'RED')
    : null
}

function parseButtons(metaButtons: MetaButton[] | undefined): TemplateButton[] {
  if (!metaButtons?.length) return []
  const out: TemplateButton[] = []
  for (const b of metaButtons) {
    switch (b.type?.toUpperCase()) {
      case 'QUICK_REPLY':
        out.push({ type: 'QUICK_REPLY', text: b.text })
        break
      case 'URL':
        out.push({
          type: 'URL',
          text: b.text,
          url: b.url ?? '',
          example: Array.isArray(b.example) ? b.example[0] : b.example,
        })
        break
      case 'PHONE_NUMBER':
        out.push({
          type: 'PHONE_NUMBER',
          text: b.text,
          phone_number: b.phone_number ?? '',
        })
        break
      case 'COPY_CODE':
        out.push({
          type: 'COPY_CODE',
          text: b.text,
          example: Array.isArray(b.example) ? b.example[0] ?? '' : b.example ?? '',
        })
        break
      // OTP, FLOW, etc — out of scope for v1; drop silently.
    }
  }
  return out
}

/** Parses a synced CAROUSEL component's cards back into our TemplateCard shape. */
function parseCards(carousel: MetaTemplateComponent | undefined): TemplateCard[] | null {
  if (!carousel?.cards?.length) return null

  const cards: TemplateCard[] = []
  for (const { components } of carousel.cards) {
    const header = components.find((c) => c.type === 'HEADER')
    const body = components.find((c) => c.type === 'BODY')
    const buttons = components.find((c) => c.type === 'BUTTONS')
    if (!body?.text) continue // malformed card — skip rather than crash the whole sync

    const headerFormat = header?.format?.toUpperCase()
    const cardHeaderFormat: TemplateCard['header_format'] =
      headerFormat === 'VIDEO' ? 'video' : 'image'

    const parsedButtons = parseButtons(buttons?.buttons).filter(
      (b): b is Exclude<TemplateButton, { type: 'COPY_CODE' }> => b.type !== 'COPY_CODE',
    )
    const bodySample = body.example?.body_text?.[0]

    cards.push({
      header_format: cardHeaderFormat,
      header_handle: header?.example?.header_handle?.[0],
      header_media_url: header?.example?.header_url?.[0],
      body_text: body.text,
      buttons: parsedButtons.length ? parsedButtons : undefined,
      sample_values: bodySample?.length ? { body: bodySample } : undefined,
    })
  }
  return cards.length ? cards : null
}

function extractSampleValues(
  body: MetaTemplateComponent | undefined,
  header: MetaTemplateComponent | undefined,
): TemplateSampleValues | null {
  // Meta returns body_text as a 2D array — one row per example set.
  // We take the first row (most templates have exactly one).
  const bodySample = body?.example?.body_text?.[0]
  const headerSample = header?.example?.header_text
  if (!bodySample?.length && !headerSample?.length) return null
  const sv: TemplateSampleValues = {}
  if (bodySample?.length) sv.body = bodySample
  if (headerSample?.length) sv.header = headerSample
  return sv
}

export interface SyncTemplatesFromMetaArgs {
  supabase: SupabaseClient
  accountId: string
  userId: string
  wabaId: string
  accessToken: string
}

/**
 * Pulls every template from the given WABA and upserts it into
 * `message_templates`, scoped to `accountId`. Same behaviour whether
 * called from the manual "Sync from Meta" button or automatically
 * right after Embedded Signup completes.
 */
export async function syncTemplatesFromMeta(
  args: SyncTemplatesFromMetaArgs,
): Promise<TemplateSyncResult> {
  const { supabase, accountId, userId, wabaId, accessToken } = args

  const metaTemplates: MetaTemplate[] = []
  let nextUrl: string | null =
    `${META_API_BASE}/${wabaId}/message_templates?limit=100&fields=id,name,language,status,category,components,quality_score`
  const PAGE_CAP = 20
  let pageCount = 0

  while (nextUrl && pageCount < PAGE_CAP) {
    pageCount++
    const metaRes: Response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!metaRes.ok) {
      let metaErr = `Meta API error: ${metaRes.status}`
      try {
        const body = await metaRes.json()
        if (body?.error?.message) metaErr = body.error.message
      } catch {
        // response wasn't JSON — keep the fallback
      }
      throw new Error(metaErr)
    }

    const metaBody: { data?: MetaTemplate[]; paging?: { next?: string } } = await metaRes.json()
    if (metaBody.data) metaTemplates.push(...metaBody.data)
    nextUrl = metaBody.paging?.next ?? null
  }

  let inserted = 0
  let updated = 0
  const errors: { name: string; language: string; message: string }[] = []

  for (const t of metaTemplates) {
    const body = (t.components ?? []).find((c) => c.type === 'BODY')
    const header = (t.components ?? []).find((c) => c.type === 'HEADER')
    const footer = (t.components ?? []).find((c) => c.type === 'FOOTER')
    const buttons = (t.components ?? []).find((c) => c.type === 'BUTTONS')
    const carousel = (t.components ?? []).find((c) => c.type === 'CAROUSEL')

    const parsedButtons = parseButtons(buttons?.buttons)
    const sampleValues = extractSampleValues(body, header)
    const cards = parseCards(carousel)

    const headerFormat = header?.format?.toUpperCase()
    const headerType =
      headerFormat === 'TEXT' ||
      headerFormat === 'IMAGE' ||
      headerFormat === 'VIDEO' ||
      headerFormat === 'DOCUMENT'
        ? headerFormat.toLowerCase()
        : null

    const row = {
      account_id: accountId,
      user_id: userId,
      name: t.name,
      category: normalizeCategory(t.category),
      language: t.language,
      header_type: headerType,
      header_content: header?.text ?? null,
      header_handle: header?.example?.header_handle?.[0] ?? null,
      body_text: body?.text ?? '',
      footer_text: footer?.text ?? null,
      buttons: parsedButtons.length ? parsedButtons : null,
      cards,
      sample_values: sampleValues,
      status: normalizeStatus(t.status),
      meta_template_id: t.id,
      quality_score: normalizeQualityScore(t.quality_score),
      updated_at: new Date().toISOString(),
    }

    const { data: existing, error: lookupErr } = await supabase
      .from('message_templates')
      .select('id')
      .eq('account_id', accountId)
      .eq('name', t.name)
      .eq('language', t.language)
      .maybeSingle()

    if (lookupErr) {
      errors.push({ name: t.name, language: t.language, message: lookupErr.message })
      continue
    }

    if (existing?.id) {
      const { error: updErr } = await supabase
        .from('message_templates')
        .update(row)
        .eq('id', existing.id)
      if (updErr) {
        errors.push({ name: t.name, language: t.language, message: updErr.message })
      } else {
        updated++
      }
    } else {
      const { error: insErr } = await supabase.from('message_templates').insert(row)
      if (insErr) {
        errors.push({ name: t.name, language: t.language, message: insErr.message })
      } else {
        inserted++
      }
    }
  }

  return {
    success: errors.length === 0,
    total: metaTemplates.length,
    inserted,
    updated,
    errors,
    truncated: pageCount >= PAGE_CAP && nextUrl !== null,
  }
}
