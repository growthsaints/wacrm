"use client"

import { Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { TopAgentStat } from '@/lib/dashboard/types'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface TopAgentsTableProps {
  data: TopAgentStat[] | null
  loading: boolean
}

export function TopAgentsTable({ data, loading }: TopAgentsTableProps) {
  const t = useTranslations('Dashboard.topAgents')

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
        ) : data.length === 0 ? (
          <EmptyState icon={Users} title={t('noAgents')} hint={t('noAgentsHint')} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">{t('agent')}</th>
                <th className="pb-2 text-right font-medium">{t('assigned')}</th>
                <th className="pb-2 text-right font-medium">{t('resolved')}</th>
                <th className="pb-2 text-right font-medium">{t('avgResponse')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((a) => (
                <tr key={a.userId}>
                  <td className="py-2 font-medium text-foreground">{a.fullName}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {a.assignedCount}
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {a.resolvedCount}
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {a.avgResponseMinutes === null
                      ? t('noSamples')
                      : `${Math.round(a.avgResponseMinutes)}m`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
