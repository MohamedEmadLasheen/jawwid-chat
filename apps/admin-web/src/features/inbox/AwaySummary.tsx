import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import { Badge } from '@/shared/components/Badge'
import { useAwaySummary } from './hooks'

/**
 * Brief §4, step 4: the morning after coverage handled her families, the owner
 * sees what happened rather than discovering it message by message.
 */
export function AwaySummary({ onOpenFamily }: { onOpenFamily: (familyId: string) => void }) {
  const { t, dateTime } = useI18n()
  const query = useAwaySummary()
  const handoffs = query.data?.handoffs ?? []

  return (
    <div className="panel">
      <h2 className="panel__title">{t('inbox.away')}</h2>
      <QueryBoundary
        isLoading={query.isLoading}
        error={query.error}
        isEmpty={handoffs.length === 0}
        emptyTitle={t('inbox.empty.covering')}
        onRetry={() => void query.refetch()}
      >
        {handoffs.map((handoff) => (
          <button
            key={handoff.id}
            type="button"
            className="row"
            onClick={() => onOpenFamily(handoff.family_id)}
          >
            <div className="row__top">
              <span className="row__name">{handoff.family_name ?? handoff.family_id}</span>
              <span className="row__wait">{dateTime(handoff.created_at)}</span>
            </div>
            {handoff.summary && <div className="row__reason">{handoff.summary}</div>}
            <div className="row__meta">
              <Badge tone="coverage">{handoff.reason}</Badge>
              {handoff.to_staff_name && <Badge>{handoff.to_staff_name}</Badge>}
            </div>
          </button>
        ))}
      </QueryBoundary>
    </div>
  )
}
