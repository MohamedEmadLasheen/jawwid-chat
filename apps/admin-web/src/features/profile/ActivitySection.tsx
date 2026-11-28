import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import { Sheet } from '@/features/profiles/RecordParts'
import type { ActivityEntry } from './api'
import { ACTION_LABEL, FIELD_LABEL, T, useCopy } from './copy'

/**
 * Official audit records (chat.audit_log) about this profile. Read only --
 * there is no route that edits or deletes one, and the table refuses it.
 */
export function ActivityList({ entries, showTarget = false }: { entries: ActivityEntry[]; showTarget?: boolean }) {
  const tx = useCopy()
  const { dateTime, locale } = useI18n()
  const comma = locale === 'ar' ? '، ' : ', '
  if (entries.length === 0) return <p className="rec-empty">{tx(T.noActivity)}</p>
  return (
    <ol className="pp-tl pp-tl--newest-first sp-log">
      {entries.map((e) => (
        <li key={e.id} className="sp-log__line">
          <div className="sp-log__what">
            {/* An act with no wording of its own is still said in words, never as its record key. */}
            <strong>{tx(ACTION_LABEL[e.action] ?? T.otherChange)}</strong>
            {showTarget && e.target.displayName && (
              <>
                {' '}
                — <bdi>{e.target.displayName}</bdi>
              </>
            )}
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

/** The profile's audit records as a sheet of the Activity tab. */
export function ActivitySection({
  query,
}: {
  query: { isLoading: boolean; error: unknown; data?: { entries: ActivityEntry[] }; refetch: () => unknown }
}) {
  const tx = useCopy()
  return (
    <Sheet id="sp-activity" section="audit" title={tx(T.activity)} rule={tx(T.activityHint)}>
      <QueryBoundary isLoading={query.isLoading} error={query.error} onRetry={() => void query.refetch()} compact>
        <ActivityList entries={query.data?.entries ?? []} />
      </QueryBoundary>
    </Sheet>
  )
}
