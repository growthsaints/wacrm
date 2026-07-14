"use client"

import { Zap } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { AutomationAnalyticsSummary } from '@/lib/dashboard/types'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'
import { cn } from '@/lib/utils'

interface AutomationAnalyticsTableProps {
  data: AutomationAnalyticsSummary | null
  loading: boolean
}

export function AutomationAnalyticsTable({ data, loading }: AutomationAnalyticsTableProps) {
  const t = useTranslations('Dashboard.automationAnalytics')

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
      </header>

      <div className="flex-1 p-5">
        {loading || !data ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : data.topPerforming.length === 0 ? (
          <EmptyState icon={Zap} title={t('noData')} hint={t('noDataHint')} />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">{t('totalExecutions')}</p>
                <p className="mt-1 text-lg font-semibold text-foreground tabular-nums">
                  {data.totalExecutions.toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">{t('successRate')}</p>
                <p className="mt-1 text-lg font-semibold text-primary tabular-nums">
                  {data.successRate}%
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">{t('failures')}</p>
                <p className="mt-1 text-lg font-semibold text-red-400 tabular-nums">
                  {data.totalFailures.toLocaleString()}
                </p>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">{t('name')}</th>
                  <th className="pb-2 text-right font-medium">{t('executions')}</th>
                  <th className="pb-2 text-right font-medium">{t('successRateCol')}</th>
                  <th className="pb-2 text-right font-medium">{t('avgTime')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.topPerforming.map((item) => (
                  <tr key={`${item.engine}-${item.id}`}>
                    <td className="py-2 font-medium text-foreground">
                      {item.name}
                      <span
                        className={cn(
                          'ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                          item.engine === 'flow'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {item.engine === 'flow' ? t('badgeFlow') : t('badgeAutomation')}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {item.executionCount}
                    </td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {item.successRate}%
                    </td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {item.avgExecutionMinutes === null
                        ? t('noSamples')
                        : `${Math.round(item.avgExecutionMinutes)}m`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>
  )
}
