import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { generateReply } from '@/lib/ai/generate'
import { loadSupportAiConfig, SUPPORT_SYSTEM_PROMPT } from '@/lib/ai/support-assistant'
import { AiError, type ChatMessage } from '@/lib/ai/types'

// Keep the transcript bounded, mirroring the tenant-facing playground.
const MAX_TURNS = 20

/**
 * POST /api/support/chat  (any logged-in team member)
 *
 * Growth Saints' own in-app product-support chat — "how do I…"
 * questions about the CRM itself, answered by a Growth-Saints-owned
 * key (see support-assistant.ts), not the tenant's own AI agent.
 * Stateless: the client resends the running transcript each turn.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireRole('viewer')

    const limit = checkRateLimit(`support-chat:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    if (!rawMessages) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 })
    }

    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' ||
            (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNS)

    if (messages.length === 0) {
      return NextResponse.json({ error: 'Send a message first.' }, { status: 400 })
    }

    const config = loadSupportAiConfig()
    if (!config) {
      return NextResponse.json(
        {
          error: 'Support chat is not set up yet. Use Contact Support instead.',
          code: 'not_configured',
        },
        { status: 400 },
      )
    }

    const { text } = await generateReply({
      config,
      systemPrompt: SUPPORT_SYSTEM_PROMPT,
      messages,
    })
    return NextResponse.json({ reply: text })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
