import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireEnterpriseFeature } from '@/lib/enterprise/guard'
import {
  getAccountOverview,
  getAccountHealth,
  getEngagementAnalytics,
} from '@/lib/enterprise/queries'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import { AiError } from '@/lib/ai/types'

const RECOMMENDATION_PROMPT = `You are a WhatsApp marketing analyst reviewing one business's own account metrics. Given the account health, delivery, and engagement data below, write 3-5 short, specific, actionable recommendations (one line each, no preamble) to improve campaign performance and account health. Only base suggestions on the numbers provided — never invent facts about the business. If the data shows no real issues, say so briefly instead of inventing problems.`

/**
 * GET /api/enterprise/ai-recommendations — generates recommendations
 * from this account's OWN real metrics using this account's OWN
 * configured AI agent (Settings → AI Agents). Requires the tenant to
 * have that set up — this reuses their existing key rather than a
 * Growth-Saints-owned one, since these are business-specific numbers.
 */
export async function GET() {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireEnterpriseFeature(supabase, accountId, role, 'ai_recommendations')

    const config = await loadAiConfig(supabase, accountId, { requireActive: false }).catch((err) => {
      console.error('[ai-recommendations] loadAiConfig error:', err)
      throw new AiError('Stored AI key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'No AI agent configured yet. Add your provider key in Settings → AI Agents.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const [overview, health, engagement] = await Promise.all([
      getAccountOverview(supabase, accountId),
      getAccountHealth(supabase, accountId),
      getEngagementAnalytics(supabase, accountId),
    ])

    const metricsSummary = `
Quality rating: ${overview.whatsapp.qualityRating ?? 'unknown'}
Messaging tier: ${overview.whatsapp.messagingLimitTier ?? 'unknown'}
Connection health: ${overview.whatsapp.health}
Messages today: ${overview.messagesToday}
Broadcast delivery rate: ${overview.broadcastPerformance.deliveryRate}%
Broadcast read rate: ${overview.broadcastPerformance.readRate}%
Broadcast reply rate: ${overview.broadcastPerformance.replyRate}%
Broadcast failure rate: ${overview.broadcastPerformance.failureRate}%
Account health score (0-100): ${health.score}
Active warnings: ${health.warnings.map((w) => w.message).join('; ') || 'none'}
Best sending hour: ${engagement.bestSendingHour ?? 'not enough data'}
Best sending day: ${engagement.bestSendingDay ?? 'not enough data'}
Top performing template: ${engagement.topTemplate?.name ?? 'none yet'} (${engagement.topTemplate?.readRate ?? 0}% read rate)
`.trim()

    const { text } = await generateReply({
      config,
      systemPrompt: RECOMMENDATION_PROMPT,
      messages: [{ role: 'user', content: metricsSummary }],
    })

    const recommendations = text
      .split('\n')
      .map((line) => line.replace(/^[-*\d.]+\s*/, '').trim())
      .filter(Boolean)

    return NextResponse.json({ recommendations })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
