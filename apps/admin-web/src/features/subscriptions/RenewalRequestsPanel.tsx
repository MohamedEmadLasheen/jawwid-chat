import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Icon } from '@/shared/components/Icon'
import { RowActions } from '@/shared/components/RowActions'
import { EmptyState, LoadingState } from '@/shared/components/States'
import { relativeTime } from '@/features/admin/copy'
import { studentPath } from '@/features/profiles/api'
import type { RenewalRequest } from './api'
import { S, describeError, isRefusal, useCopy } from './copy'
import { useRenewalRequests } from './hooks'
import './subscriptions.css'

/**
 * PD-30 (A): parents of locked children with nothing to pay yet asked to renew
 * -- the staff queue, on one sheet: who still waits first, then who was
 * renewed since. A row opens the child's Student Profile.
 */
export function RenewalRequestsPanel() {
  const tx = useCopy()
  const { locale } = useI18n()
  const q = useRenewalRequests()
  // A reader the server refuses sees no queue: one calm line where the list would be.
  if (q.error && isRefusal(q.error)) {
    return (
      <p className="rn__denied">
        <Icon name="lock" size={16} />
        <span>{tx(S.renewalsDenied)}</span>
      </p>
    )
  }
  const rows = q.data?.requests ?? []
  const waiting = rows.filter((r) => !r.renewed)
  const renewed = rows.filter((r) => r.renewed)
  return (
    <section className="sheet rn" aria-labelledby="pay-renewals">
      <h2 id="pay-renewals" className="sr-only">
        {tx(S.renewalsTitle)}
      </h2>
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
        <>
          <Group title={tx(S.waiting)} rows={waiting} waiting />
          <Group title={tx(S.renewed)} rows={renewed} />
          {/* What the queue is and what to do with it, at its foot. */}
          <p className="rn__foot">{tx(S.renewalsHint)}</p>
        </>
      )}
    </section>
  )
}

function Group({ title, rows, waiting = false }: { title: string; rows: RenewalRequest[]; waiting?: boolean }) {
  const tx = useCopy()
  const { locale, dateTime, number } = useI18n()
  if (rows.length === 0) return null
  return (
    <div className="rn-group">
      <h3 className="rn-group__head">
        <span>{title}</span>
        <span className={waiting ? 'count' : 'count count--quiet'}>{number(rows.length)}</span>
      </h3>
      <ul className="rn-list">
        {rows.map((r) => (
          <li key={r.id} className="rn-row">
            <div className="entity">
              <Avatar name={r.child.name} seed={r.child.id} size="sm" />
              <div className="entity__text">
                <span className="entity__name">
                  <bdi>{r.child.name}</bdi>
                </span>
                <span className="entity__sub">
                  <bdi>{r.parentName}</bdi>
                </span>
              </div>
            </div>
            <time className="rn-row__when" dateTime={r.requestedAt} title={dateTime(r.requestedAt)}>
              {relativeTime(r.requestedAt, locale)}
            </time>
            <RowActions
              primary={
                <Link className="btn btn--sm" to={studentPath(r.child.id)} aria-label={tx(S.openStudentNamed, { name: r.child.name })}>
                  {tx(S.openStudent)}
                </Link>
              }
              label={tx(S.openStudentNamed, { name: r.child.name })}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
