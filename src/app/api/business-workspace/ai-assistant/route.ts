import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import { AiError } from '@/lib/ai/types'

const TASKS = {
  summarize: 'Summarize the following WhatsApp conversation in 2-3 short sentences. Only state what is actually written — never invent details.',
  suggest_reply:
    'Given this WhatsApp conversation, suggest one short, natural reply the business could send next. Reply with only the suggested message text, nothing else.',
  translate: 'Translate the following text to {target}. Reply with only the translation, nothing else.',
  improve_grammar: 'Fix the grammar and spelling of the following text without changing its meaning or tone. Reply with only the corrected text.',
  change_tone: 'Rewrite the following text in a {tone} tone, keeping the same meaning. Reply with only the rewritten text.',
  qualify_lead:
    'Based on the following conversation, assess how qualified this lead appears (Hot/Warm/Cold) and give one sentence why. Only base this on what is actually written.',
  detect_intent:
    'Identify the primary customer intent in the following message or conversation (e.g. purchase inquiry, support request, complaint, general question). Reply with a short label and one sentence of reasoning.',
  sentiment: 'Analyze the sentiment of the following text (Positive/Neutral/Negative) and give one short sentence why.',
} as const

type Task = keyof typeof TASKS

/**
 * POST /api/business-workspace/ai-assistant
 * Body: { task, input, target?, tone? }
 *
 * Reuses the tenant's own configured AI Agent (Settings -> AI Agents)
 * — same pattern as Campaign Intelligence's AI Recommendations. Each
 * task is a distinct system prompt; the input is whatever text the
 * user pastes in (a conversation excerpt, a draft reply, etc.) rather
 * than an automatic conversation fetch, to keep this a general-purpose
 * assistant rather than a single hardcoded conversation source.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'ai_assistant')

    const body = (await request.json().catch(() => null)) as
      | { task?: unknown; input?: unknown; target?: unknown; tone?: unknown }
      | null
    const task = typeof body?.task === 'string' ? (body.task as Task) : null
    const input = typeof body?.input === 'string' ? body.input.trim() : ''
    if (!task || !(task in TASKS)) return NextResponse.json({ error: 'Invalid task' }, { status: 400 })
    if (!input) return NextResponse.json({ error: 'Input text is required' }, { status: 400 })

    const config = await loadAiConfig(supabase, accountId, { requireActive: false }).catch((err) => {
      console.error('[ai-assistant] loadAiConfig error:', err)
      throw new AiError('Stored AI key could not be decrypted.', { code: 'key_decrypt_failed', status: 400 })
    })
    if (!config) {
      return NextResponse.json(
        { error: 'No AI agent configured yet. Add your provider key in Settings → AI Agents.', code: 'ai_not_configured' },
        { status: 400 },
      )
    }

    let systemPrompt: string = TASKS[task]
    if (task === 'translate') {
      const target = typeof body?.target === 'string' && body.target.trim() ? body.target.trim() : 'English'
      systemPrompt = systemPrompt.replace('{target}', target)
    }
    if (task === 'change_tone') {
      const tone = typeof body?.tone === 'string' && body.tone.trim() ? body.tone.trim() : 'friendly'
      systemPrompt = systemPrompt.replace('{tone}', tone)
    }

    const { text } = await generateReply({
      config,
      systemPrompt,
      messages: [{ role: 'user', content: input }],
    })

    return NextResponse.json({ result: text.trim() })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
