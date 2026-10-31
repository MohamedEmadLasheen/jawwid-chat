import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import { FilterChips } from '@/shared/components/FilterChips'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import type { Instalment, InstalmentStatus, Responsible } from './api'
import { I, STATUS_LABEL, describeError, formatDay, formatMoney, useCopy } from './copy'
import { useInstalments } from './hooks'
import { BillingSupervisorDialog } from './BillingSupervisorDialog'
import { parentPath } from '@/features/profiles/api'
import './instalments.css'

const STATUS_TONE: Record<InstalmentStatus, Tone> = { overdue: 'danger', due: 'warn', upcoming: 'info', paid: 'ok' }

/**
 * PD-12 S3: Instalment Payments. One list, in the server's order (overdue
 * oldest first, due today, upcoming soonest), of the instalments recorded in
 * Chat (PD-17) for the families this viewer may see. A row opens the payer's
 * Parent Profile -- where payments are recorded -- and the family's
 * conversation; the Operations Manager (and the super admin) set a family's
 * billing supervisor from it.
 */
export function InstalmentsPage({ eyebrow }: { eyebrow?: string }) {
  const tx = useCopy()
  const { locale } = useI18n()
  // PD-44: the supervisor filter lives in the URL, so the Dashboard's "no
  // billing supervisor" tile opens it (/instalments?responsible=none).
  const [params, setParams] = useSearchParams()
  const asked = params.get('responsible')
  const responsible: Responsible = asked === 'me' || asked === 'none' ? asked : 'all'
  const setResponsible = (next: Responsible) =>
    setParams((current) => {
      const p = new URLSearchParams(current)
      if (next === 'all') p.delete('responsible')
      else p.set('responsible', next)
      return p
    }, { replace: true })
  const [paid, setPaid] = useState(false)
  const [beforeGoLive, setBeforeGoLive] = useState(false)
  const [assigning, setAssigning] = useState<Instalment | null>(null)
  const list = useInstalments({ responsible, paid, beforeGoLive })
  const data = list.data

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader eyebrow={eyebrow} title={tx(I.title)} subtitle={tx(I.subtitle)} />
        <div className="toolbar in-toolbar">
          <FilterChips<Responsible>
            label={tx(I.supervisor)}
            value={responsible}
            onChange={setResponsible}
            options={[
              { value: 'all', label: tx(I.all) },
              { value: 'me', label: tx(I.mine) },
              { value: 'none', label: tx(I.noSupervisor) },
            ]}
          />
          <label className="in-check">
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
            {tx(I.showPaid)}
          </label>
          <label className="in-check">
            <input type="checkbox" checked={beforeGoLive} onChange={(e) => setBeforeGoLive(e.target.checked)} />
            {tx(I.beforeGoLive)}
            {data?.counts.beforeGoLive ? ` (${data.counts.beforeGoLive})` : ''}
          </label>
        </div>
        {beforeGoLive && data?.lockFrom && <p className="field__hint">{tx(I.beforeGoLiveHint, { date: formatDay(data.lockFrom, locale) })}</p>}
        {list.error ? (
          <EmptyState icon="alert" title={describeError(list.error, locale)} />
        ) : (
          <QueryBoundary isLoading={list.isLoading} error={null} onRetry={() => void list.refetch()}>
            {
              <>
                {data && (
                  <p className="in-summary" role="status">
                    {tx(I.counts, data.counts)}
                    {data.counts.unassigned > 0 && ` · ${tx(I.countsUnassigned, { n: data.counts.unassigned })}`}
                  </p>
                )}
                {!data || data.items.length === 0 ? (
                  <EmptyState title={tx(responsible === 'all' ? I.empty : I.emptyFiltered)} />
                ) : (
                  <div className="table-wrap in-table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th scope="col">{tx(I.account)}</th>
                          <th scope="col">{tx(I.forWhom)}</th>
                          <th scope="col">{tx(I.amount)}</th>
                          <th scope="col">{tx(I.dueDate)}</th>
                          <th scope="col">{tx(I.supervisor)}</th>
                          <th scope="col">
                            <span className="sr-only">{tx(I.open)}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.items.map((row) => (
                          <InstalmentRow
                            key={row.id}
                            row={row}
                            canAssign={data.canAssignBillingSupervisor}
                            onAssign={() => setAssigning(row)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            }
          </QueryBoundary>
        )}
        {assigning && (
          <BillingSupervisorDialog
            familyId={assigning.family.id}
            familyName={assigning.family.name}
            onClose={() => setAssigning(null)}
          />
        )}
      </div>
    </div>
  )
}

function InstalmentRow({ row, canAssign, onAssign }: { row: Instalment; canAssign: boolean; onAssign: () => void }) {
  const tx = useCopy()
  const { locale, date } = useI18n()
  const when =
    row.status === 'overdue'
      ? tx(I.overdueBy, { n: row.days })
      : row.status === 'upcoming'
        ? tx(I.inDays, { n: row.days })
        : row.status === 'paid' && row.paidAt
          ? tx(I.paidOn, { date: date(row.paidAt) })
          : null
  const forWhom = row.child === null ? tx(I.family) : row.child.name ?? ''
  return (
    <tr>
      <td>
        <div className="in-cell">
          {row.account.id ? (
            <Link to={parentPath(row.account.id)} aria-label={tx(I.openProfile, { name: row.account.name })}>
              <strong dir="auto">{row.account.name}</strong>
            </Link>
          ) : (
            <strong dir="auto">{row.account.name}</strong>
          )}
          {row.account.name !== row.family.name && (
            <span className="in-muted" dir="auto">
              {row.family.name}
            </span>
          )}
        </div>
      </td>
      <td>
        <div className="in-cell">
          <span dir="auto">{forWhom}</span>
          {row.label && (
            <span className="in-muted" dir="auto">
              {row.label}
            </span>
          )}
        </div>
      </td>
      <td className="in-amount">{formatMoney(row.amountMinor, row.currency, locale)}</td>
      <td>
        <div className="in-cell">
          <Badge tone={STATUS_TONE[row.status]} dot>
            {tx(STATUS_LABEL[row.status])}
          </Badge>
          <span>{formatDay(row.dueDate, locale)}</span>
          {when && <span className="in-muted">{when}</span>}
          {row.beforeGoLive && <Badge tone="outline">{tx(I.beforeGoLiveBadge)}</Badge>}
        </div>
      </td>
      <td>
        <div className="in-cell">
          {row.responsibleSupervisor ? (
            <span dir="auto">{row.responsibleSupervisor.name}</span>
          ) : (
            <span className="in-muted">{tx(row.responsibleBasis === 'child' ? I.unassignedChild : I.unassigned)}</span>
          )}
          <span className="in-muted">{tx(row.responsibleBasis === 'child' ? I.childBasis : I.billingBasis)}</span>
          {canAssign && row.responsibleBasis === 'family' && (
            <button type="button" className="btn btn--sm" onClick={onAssign}>
              {tx(row.responsibleSupervisor ? I.changeSupervisor : I.setSupervisor)}
            </button>
          )}
        </div>
      </td>
      <td>
        {row.conversationId ? (
          <Link className="btn btn--sm" to={`/chat/${encodeURIComponent(row.conversationId)}`}>
            {tx(I.open)}
          </Link>
        ) : (
          <span className="in-muted">{tx(I.noConversation)}</span>
        )}
      </td>
    </tr>
  )
}
