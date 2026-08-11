import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { requireBusinessWorkspaceFeature } from '@/lib/business-workspace/guard'

const PAGE_SIZE_DEFAULT = 25
const PAGE_SIZE_MAX = 100
const SENDER_TYPES = ['customer', 'agent', 'bot'] as const
type SenderType = (typeof SENDER_TYPES)[number]

/**
 * GET /api/business-workspace/message-history
 *
 * A searchable, filterable, paginated view across every message in the
 * account — the gap between the per-conversation Inbox thread (one
 * contact at a time) and the per-broadcast recipient table (one
 * campaign at a time). Reuses the same `reports` feature gate as the
 * existing workspace Reports page since this is another report, not a
 * new licensed feature.
 *
 * Query params:
 *   q          — matched against message content_text (ILIKE)
 *   direction  — 'customer' | 'agent' | 'bot' (omit for all)
 *   from / to  — ISO date bounds on created_at
 *   page       — 1-based, default 1
 *   pageSize   — default 25, capped at 100
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, role } = await getCurrentAccount()
    await requireBusinessWorkspaceFeature(supabase, accountId, role, 'reports')

    const url = new URL(request.url)
    const q = url.searchParams.get('q')?.trim() || ''
    const directionParam = url.searchParams.get('direction')
    const direction = SENDER_TYPES.includes(directionParam as SenderType)
      ? (directionParam as SenderType)
      : null
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(
      PAGE_SIZE_MAX,
      Math.max(1, parseInt(url.searchParams.get('pageSize') ?? String(PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT),
    )
    const rangeFrom = (page - 1) * pageSize
    const rangeTo = rangeFrom + pageSize - 1

    let query = supabase
      .from('messages')
      .select(
        'id, content_text, content_type, sender_type, status, created_at, conversation_id, conversations!inner(account_id, contact_id, contacts(id, name, phone))',
        { count: 'exact' },
      )
      .eq('conversations.account_id', accountId)
      .order('created_at', { ascending: false })
      .range(rangeFrom, rangeTo)

    if (q) query = query.ilike('content_text', `%${q}%`)
    if (direction) query = query.eq('sender_type', direction)
    if (from) query = query.gte('created_at', from)
    if (to) query = query.lte('created_at', to)

    const { data, error, count } = await query
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      messages: data ?? [],
      total: count ?? 0,
      page,
      pageSize,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
