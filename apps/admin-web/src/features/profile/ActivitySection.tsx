import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import type { ActivityEntry } from './api'
import { ACTION_LABEL, FIELD_LABEL, T, labelFor, useCopy } from './copy'

/**
 * Section 5: official audit records (chat.audit_log) about this profile. Read
 * only -- there is no route that edits or deletes one, and the table refuses it.
 */
export function ActivityList({ entries, showTarget = false }: { entries: ActivityEntry[]; showTarget?: boolean }) {
  const tx = useCopy()
  const { dateTime, locale } = useI18n()
  const comma = locale === 'ar' ? '، ' : ', '
  if (entries.length === 0) return <p className="sp-muted">{tx(T.noActivity)}</p>
  return (
    <ol className="sp-timeline">
      {entries.map((e) => (
        <li key={e.id} className="sp-timeline__item">
          <div>
            <strong>{tx(labelFor(ACTION_LABEL, e.action))}</strong>
            {showTarget && e.target.displayName && <> — {e.target.displayName}</>}
          </div>
          <div className="sp-muted sp-small">
            <time dateTime={e.at}>{dateTime(e.at)}</time> ·{' '}
            {e.actor ? tx(T.by, { who: e.actor.displayName }) : tx(T.system)}
          </div>
          {e.changedFields.length > 0 && (
            <div className="sp-small">
              {tx(T.fields)}:{' '}
              {e.changedFields
                .flatMap((f) => {
                  const label = FIELD_LABEL[f]
                  return label ? [tx(label)] : []
                })
                .join(comma)}
            </div>
          )}
          <div className="sp-small sp-muted">
            {tx(T.reason)}: <span dir="auto">{e.reason}</span>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function ActivitySection({
  query,
}: {
  query: { isLoading: boolean; error: unknown; data?: { entries: ActivityEntry[] }; refetch: () => unknown }
}) {
  const tx = useCopy()
  return (
    <section className="card sp-card" aria-labelledby="sp-activity">
      <h2 id="sp-activity" className="sp-card__title">{tx(T.activity)}</h2>
      <p className="sp-footnote">{tx(T.activityHint)}</p>
      <QueryBoundary isLoading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
        <ActivityList entries={query.data?.entries ?? []} />
      </QueryBoundary>
    </section>
  )
}
