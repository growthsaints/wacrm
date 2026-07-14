"use client"

import Link from 'next/link'
import { Radio } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { TopCampaignStat } from '@/lib/dashboard/types'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface TopCampaignsTableProps {
  data: TopCampaignStat[] | null
  loading: boolean
}

export function TopCampaignsTable({ data, loading }: TopCampaignsTableProps) {
  const t = useTranslations('Dashboard.topCampaigns')

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
          <EmptyState icon={Radio} title={t('noCampaigns')} hint={t('noCampaignsHint')} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">{t('campaign')}</th>
                <th className="pb-2 text-right font-medium">{t('sent')}</th>
                <th className="pb-2 text-right font-medium">{t('delivered')}</th>
                <th className="pb-2 text-right font-medium">{t('read')}</th>
                <th className="pb-2 text-right font-medium">{t('replied')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 font-medium text-foreground">
                    <Link href={`/broadcasts/${c.id}`} className="hover:text-primary hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {c.sentCount}
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {c.deliveredCount}
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {c.readCount}
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {c.repliedCount}
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
