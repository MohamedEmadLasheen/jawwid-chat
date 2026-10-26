import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { studentPath } from '@/features/profiles/api'
import { S, isRefusal, useCopy } from './copy'
import { useRenewalRequests } from './hooks'

/** PD-30 (A): parents of locked children with nothing to pay yet asked to renew -- the staff queue. */
export function RenewalRequestsPanel() {
  const tx = useCopy()
  const { locale } = useI18n()
  const q = useRenewalRequests()
  if (q.error && isRefusal(q.error)) return null
  const rows = q.data?.requests ?? []
  return (
    <section className="card panel tf-section" aria-labelledby="pay-renewals">
      <div className="tf-section__head">
        <h2 id="pay-renewals" className="tf-section__title">
          {tx(S.renewalsTitle)}
        </h2>
      </div>
      <p className="field__hint">{tx(S.renewalsHint)}</p>
      {rows.length === 0 ? (
        <p className="tf-muted">{tx(S.noRenewals)}</p>
      ) : (
        <ul className="sub-ledger">
          {rows.map((r) => (
            <li key={r.id} className="sub-ledger__row">
              <Badge tone={r.renewed ? 'ok' : 'warn'} dot>
                {tx(r.renewed ? S.renewed : S.waiting)}
              </Badge>
              <Link to={studentPath(r.child.id)} dir="auto">
                {r.child.name}
              </Link>
              <span className="tf-muted" dir="auto">
                {r.parentName} · {new Date(r.requestedAt).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
