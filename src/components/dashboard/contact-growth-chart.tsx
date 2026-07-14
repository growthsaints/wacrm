"use client"

import { UserPlus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ContactGrowthPoint } from '@/lib/dashboard/types'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'
import { cn } from '@/lib/utils'

type RangeDays = 7 | 30 | 90

interface ContactGrowthChartProps {
  /** Per-range data, so switching tabs never re-fetches — same caching
   *  contract as ConversationsChart. */
  series: Record<RangeDays, ContactGrowthPoint[] | null>
  loading: boolean
  range: RangeDays
  onRangeChange: (r: RangeDays) => void
}

export function ContactGrowthChart({ series, loading, range, onRangeChange }: ContactGrowthChartProps) {
  const t = useTranslations('Dashboard.contactGrowth')
  const data = series[range]
  const max = Math.max(1, ...(data ?? []).map((p) => p.count))

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
          {[7, 30, 90].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRangeChange(r as RangeDays)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                range === r
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t('days', { count: r })}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 p-5">
        {loading || !data ? (
          <Skeleton className="h-[160px] w-full" />
        ) : data.every((p) => p.count === 0) ? (
          <EmptyState icon={UserPlus} title={t('noActivity')} hint={t('noActivityHint')} />
        ) : (
          <div className="flex h-[160px] items-end gap-0.5" role="img" aria-label={t('title')}>
            {data.map((p) => (
              <div
                key={p.day}
                title={`${p.day}: ${p.count}`}
                className="group relative flex-1"
                style={{ height: '100%' }}
              >
                <div
                  className="absolute bottom-0 w-full rounded-t-sm bg-primary/70 transition-colors group-hover:bg-primary"
                  style={{ height: `${Math.max(2, (p.count / max) * 100)}%` }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
