import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { EmptyState, LoadingState } from '@/shared/components/States'
import { relativeTime } from '@/features/admin/copy'
import { studentPath } from '@/features/profiles/api'
import { S, describeError, isRefusal, useCopy } from './copy'
import { useRenewalRequests } from './hooks'
import './subscriptions.css'

/** PD-30 (A): parents of locked children with nothing to pay yet asked to renew -- the staff queue. */
export function RenewalRequestsPanel() {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const q = useRenewalRequests()
  // A reader the server refuses sees no queue: one calm line where the list would be.
  if (q.error && isRefusal(q.error)) {
    return (
      <p className="rn__denied">
        <Icon name="lockNote" size={16} />
        <span>{tx(S.renewalsDenied)}</span>
      </p>
    )
  }
  const rows = q.data?.requests ?? []
  return (
    <section className="rn" aria-labelledby="pay-renewals">
      <h2 id="pay-renewals" className="sr-only">
        {tx(S.renewalsTitle)}
      </h2>
      {/* With a queue to work, what it is and what to do; an empty one says so itself. */}
      {rows.length > 0 && <p className="rn__hint">{tx(S.renewalsHint)}</p>}
      {q.isLoading ? (
        <LoadingState compact />
      ) : q.error ? (
        // A failed read is said, never shown as "no requests".
        <EmptyState icon="alert" title={describeError(q.error, locale)} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={tx(S.noRenewals)}
          hint={tx(S.noRenewalsHint)}
          action={
            <Link className="btn btn--sm" to="/parents">
              {tx(S.openParents)}
            </Link>
          }
        />
      ) : (
        <ul className="rn-list">
          {rows.map((r) => (
            <li key={r.id} className="rn-row">
              <div className="entity">
                <Avatar name={r.child.name} seed={r.child.id} size="sm" />
                <div className="entity__text">
                  <Link className="entity__name rn-row__name" to={studentPath(r.child.id)}>
                    <bdi>{r.child.name}</bdi>
                  </Link>
                  <span className="entity__sub">
                    <bdi>{r.parentName}</bdi>
                  </span>
                </div>
              </div>
              <time className="rn-row__when" dateTime={r.requestedAt} title={dateTime(r.requestedAt)}>
                {relativeTime(r.requestedAt, locale)}
              </time>
              <Badge tone={r.renewed ? 'ok' : 'warn'} dot>
                {tx(r.renewed ? S.renewed : S.waiting)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
