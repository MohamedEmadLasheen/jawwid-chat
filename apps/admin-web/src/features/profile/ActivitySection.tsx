import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import type { ActivityEntry } from './api'
import { ACTION_LABEL, FIELD_LABEL, T, useCopy } from './copy'

/**
 * Section 5: official audit records (chat.audit_log) about this profile. Read
 * only -- there is no route that edits or deletes one, and the table refuses it.
 */
export function ActivityList({ entries, showTarget = false }: { entries: ActivityEntry[]; showTarget?: boolean }) {
  const tx = useCopy()
  const { dateTime, locale } = useI18n()
  const comma = locale === 'ar' ? '، ' : ', '
  if (entries.length === 0) return <p className="pp-empty">{tx(T.noActivity)}</p>
  return (
    <ol className="pp-tl pp-tl--newest-first">
      {entries.map((e) => (
        <li key={e.id}>
          <div>
            {/* An act with no wording of its own is still said in words, never as its record key. */}
            <strong>{tx(ACTION_LABEL[e.action] ?? T.otherChange)}</strong>
            {showTarget && e.target.displayName && <> — {e.target.displayName}</>}
          </div>
          <div className="pp-tl__when">
            <time dateTime={e.at}>{dateTime(e.at)}</time> ·{' '}
            {e.actor ? tx(T.by, { who: e.actor.displayName }) : tx(T.system)}
          </div>
          {e.changedFields.length > 0 && (
            <div className="pp-tl__when">
              {tx(T.fields)}:{' '}
              {e.changedFields
                .flatMap((f) => {
                  const label = FIELD_LABEL[f]
                  return label ? [tx(label)] : []
                })
                .join(comma)}
            </div>
          )}
          <div className="pp-tl__when">
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
    <section className="pp-sec" aria-labelledby="sp-activity">
      <div className="pp-sec__head">
        <h2 id="sp-activity" className="pp-sec__title">{tx(T.activity)}</h2>
      </div>
      <p className="pp-rule">{tx(T.activityHint)}</p>
      <QueryBoundary isLoading={query.isLoading} error={query.error} onRetry={() => void query.refetch()} compact>
        <ActivityList entries={query.data?.entries ?? []} />
      </QueryBoundary>
    </section>
  )
}
