import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { HAND_OVER_STATES, type ChannelKind, type HandOverRow } from './api'
import { H, HAND_OVER_BLOCKER, HAND_OVER_STATE, P } from './copy'
import { useHandOver } from './hooks'

const KIND = { phone: P.phone, whatsapp: P.whatsapp, email: P.email } as const

/**
 * PD-59 (option O4): the leads a subscribed trial made Converted that are not linked to a family record
 * yet. For the Sales manager and the super admin only (the page asks only when the server's access answer
 * says so, and the server refuses everyone else again). READ-ONLY: it offers no write action, shows the
 * channel KINDS the family's record has no room for and never a contact value; a lead is opened in the
 * pipeline's own panel, where Convert already lives.
 */
export function NeedsHandOver({ onOpen }: { onOpen: (id: string) => void }) {
  const { locale, number } = useI18n()
  const tx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const list = useHandOver(true)
  const data = list.data
  const kinds = (r: HandOverRow) => r.missingKinds.map((k: ChannelKind) => tx(KIND[k])).join(' · ')

  return (
    <section aria-label={tx(H.title)}>
      <p className="field__hint">{tx(H.intro)}</p>
      <p className="field__hint">{tx(H.guidance)}</p>
      <QueryBoundary isLoading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
        {!data || data.leads.length === 0 ? (
          <EmptyState title={tx(H.empty)} />
        ) : (
          <>
            <ul className="sp-handover-counts">
              {HAND_OVER_STATES.map((s) => (
                <li key={s}><Badge tone={HAND_OVER_STATE[s].tone}>{tx(HAND_OVER_STATE[s].label)}: {number(data.counts[s])}</Badge></li>
              ))}
            </ul>
            <div className="table-wrap">
              <table className="table sp-table">
                <thead>
                  <tr>
                    <th scope="col">{tx(P.lead)}</th>
                    <th scope="col">{tx(P.stage)}</th>
                    <th scope="col">{tx(H.age)}</th>
                    <th scope="col">{tx(P.owner)}</th>
                    <th scope="col">{tx(H.contactCopy)}</th>
                    <th scope="col">{tx(H.enrolled)}</th>
                    <th scope="col">{tx(H.status)}</th>
                    <th scope="col"><span className="sr-only">{tx(P.open)}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.leads.map((r) => (
                    <tr key={r.id}>
                      <th scope="row" dir="auto">{r.displayName}</th>
                      <td><Badge tone={HAND_OVER_STATE[r.state].tone} dot>{tx(HAND_OVER_STATE[r.state].label)}</Badge></td>
                      <td>{number(r.ageDays)} {tx(H.days)}</td>
                      <td dir="auto">{r.owner?.name || <span className="ts-muted">{tx(P.unassigned)}</span>}</td>
                      <td>{r.hasContactCopy ? tx(H.yes) : tx(H.no)}</td>
                      <td>{r.enrolled ? tx(H.yes) : tx(H.no)}</td>
                      <td>
                        {tx(HAND_OVER_BLOCKER[r.blocker])}
                        {r.blocker === 'channel_missing' && r.missingKinds.length > 0 && (
                          <div className="ts-muted">{tx(H.missing)}: {kinds(r)}</div>
                        )}
                      </td>
                      <td><button type="button" className="btn btn--sm" onClick={() => onOpen(r.id)} aria-label={`${tx(P.open)} ${r.displayName}`}>{tx(P.open)}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.truncated && <p className="field__hint">{tx(P.truncated)}</p>}
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
