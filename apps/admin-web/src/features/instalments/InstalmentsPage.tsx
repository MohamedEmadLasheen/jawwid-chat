import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge, type Tone } from '@/shared/components/Badge'
import { FilterChips } from '@/shared/components/FilterChips'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import type { Instalment, InstalmentStatus, Responsible } from './api'
import { I, OPEN_ONES, STATUS_LABEL, countWords, describeError, formatDay, inDaysWords, lateWords, useCopy } from './copy'
import { useInstalments } from './hooks'
import { BillingSupervisorDialog } from './BillingSupervisorDialog'
import { parentPath } from '@/features/profiles/api'
import { FinanceLedger } from '@/features/payments/FinanceLedger'
import { Money } from '@/features/payments/Money'
import './instalments.css'

const STATUS_TONE: Record<InstalmentStatus, Tone> = { overdue: 'danger', due: 'warn', upcoming: 'info', paid: 'ok' }

/** The rows of one plan: a family's own instalments, or one child's. */
const planKey = (row: Instalment) => `${row.family.id}:${row.child ? (row.child.id ?? '?') : 'family'}`

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
  const filtered = responsible !== 'all' || beforeGoLive
  // What the list holds of each plan: all of it (paid included, nothing filtered out),
  // only what is still open, or a filtered part that is not numbered.
  const planView: PlanView = responsible !== 'all' || beforeGoLive ? 'part' : paid ? 'whole' : 'open'

  // Each row's plan, in due order, from the rows this list already holds.
  const plans = useMemo(() => {
    const by = new Map<string, Instalment[]>()
    for (const row of data?.items ?? []) {
      const key = planKey(row)
      const rows = by.get(key)
      if (rows) rows.push(row)
      else by.set(key, [row])
    }
    for (const rows of by.values()) rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))
    return by
  }, [data])

  const clear = () => {
    setBeforeGoLive(false)
    setResponsible('all')
  }

  return (
    <div className="page in-page">
      <div className="page__inner">
        <PageHeader eyebrow={eyebrow} title={tx(I.title)} subtitle={tx(I.subtitle)} />
        <FinanceLedger here="instalments" />
        <div className="in-toolbar" role="group" aria-label={tx(I.filters)}>
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
          {data && data.counts.unassigned > 0 && (
            <span className="in-toolbar__note" aria-hidden="true">
              {tx(I.countsUnassigned, { n: data.counts.unassigned })}
            </span>
          )}
        </div>
        {beforeGoLive && data?.lockFrom && <p className="notice in-hint">{tx(I.beforeGoLiveHint, { date: formatDay(data.lockFrom, locale) })}</p>}
        {list.error ? (
          <EmptyState icon="alert" title={describeError(list.error, locale)} />
        ) : (
          <QueryBoundary isLoading={list.isLoading} error={null} onRetry={() => void list.refetch()}>
            {
              <>
                {data && (
                  // The ledger above shows these counts; this line says them to a screen reader.
                  <p className="sr-only" role="status">
                    {tx(I.counts, data.counts)}
                    {data.counts.unassigned > 0 && ` · ${tx(I.countsUnassigned, { n: data.counts.unassigned })}`}
                  </p>
                )}
                {!data || data.items.length === 0 ? (
                  filtered ? (
                    <EmptyState
                      title={tx(responsible === 'all' ? I.empty : I.emptyFiltered)}
                      hint={tx(I.emptyFilteredHint)}
                      action={
                        <button type="button" className="btn btn--sm" onClick={clear}>
                          {tx(I.showAll)}
                        </button>
                      }
                    />
                  ) : (
                    <EmptyState
                      title={tx(I.empty)}
                      hint={tx(I.emptyHint)}
                      action={
                        <Link className="btn btn--sm" to="/parents">
                          {tx(I.openParents)}
                        </Link>
                      }
                    />
                  )
                ) : (
                  <>
                  {/* What the plan column's marks mean. Each strip also says it in words. */}
                  <p className="plan-key" aria-hidden="true">
                    <span className="plan-key__name">{tx(I.planKey)}</span>
                    <span className="plan-key__item">
                      <span className="plan__tick plan__tick--paid" />
                      {tx(I.keyPaid)}
                    </span>
                    <span className="plan-key__item">
                      <span className="plan__tick plan__tick--overdue" />
                      {tx(I.keyLate)}
                    </span>
                    <span className="plan-key__item">
                      <span className="plan__tick plan__tick--due" />
                      {tx(I.keyDue)}
                    </span>
                    <span className="plan-key__item">
                      <span className="plan__tick" />
                      {tx(I.keyUpcoming)}
                    </span>
                    <span className="plan-key__item">
                      <span className="plan__tick plan__tick--paid plan__tick--here" />
                      {tx(I.keyHere)}
                    </span>
                  </p>
                  <div className="table-wrap in-table-wrap">
                    <table className="table in-table">
                      <thead>
                        <tr>
                          <th scope="col">{tx(I.account)}</th>
                          <th scope="col">{tx(I.forWhom)}</th>
                          <th scope="col">
                            <span title={tx(I.planHint)}>{tx(I.plan)}</span>
                          </th>
                          <th scope="col">{tx(I.dueDate)}</th>
                          <th scope="col" className="in-th-amount">
                            {tx(I.amount)}
                          </th>
                          <th scope="col">{tx(I.status)}</th>
                          <th scope="col">{tx(I.supervisorShort)}</th>
                          <th scope="col">
                            <span className="sr-only">{tx(I.open)}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.items.map((row, i) => (
                          <InstalmentRow
                            key={row.id}
                            row={row}
                            // Where the list passes from late to due today to upcoming, the rule is a shade firmer.
                            opens={i > 0 && data.items[i - 1]!.status !== row.status}
                            plan={plans.get(planKey(row)) ?? [row]}
                            view={planView}
                            canAssign={data.canAssignBillingSupervisor}
                            onAssign={() => setAssigning(row)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </>
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

/**
 * One tick per instalment of the plan that this list holds: paid, late, due
 * today, still to come. The row's own instalment stands taller.
 */
type PlanView = 'whole' | 'open' | 'part'

function PlanStrip({ row, plan, view }: { row: Instalment; plan: Instalment[]; view: PlanView }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const at = plan.findIndex((r) => r.id === row.id) + 1
  // Without the paid instalments the list holds only what is still open: say so, never "2 of 4".
  const count = (status: InstalmentStatus) => plan.filter((r) => r.status === status).length
  const said = (
    [
      [count('paid'), I.keyPaid],
      [count('overdue'), I.keyLate],
      [count('due'), I.keyDue],
      [count('upcoming'), I.keyUpcoming],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${tx(word)}`)
    .join(locale === 'ar' ? '، ' : ', ')
  // "Instalment 2 of 4: 1 paid, 1 late, 2 to come".
  const label = `${tx(view === 'whole' ? I.planLabel : I.planOpenLabel, { i: at, n: plan.length })}: ${said}`
  return (
    <span className="plan" role="img" aria-label={label} title={label}>
      <span className="plan__ticks">
        {plan.map((r) => (
          <span key={r.id} className={`plan__tick plan__tick--${r.status}${r.id === row.id ? ' plan__tick--here' : ''}`} />
        ))}
      </span>
      {view === 'whole' ? (
        <span className="plan__at" dir="ltr">
          {at}/{plan.length}
        </span>
      ) : view === 'open' ? (
        <span className="plan__at">{countWords(plan.length, OPEN_ONES, locale)}</span>
      ) : null}
    </span>
  )
}

function InstalmentRow({
  row,
  plan,
  view,
  opens,
  canAssign,
  onAssign,
}: {
  row: Instalment
  plan: Instalment[]
  view: PlanView
  opens: boolean
  canAssign: boolean
  onAssign: () => void
}) {
  const tx = useCopy()
  const { locale, date } = useI18n()
  const day = formatDay(row.dueDate, locale)
  const when =
    row.status === 'overdue'
      ? lateWords(row.days, locale)
      : row.status === 'upcoming'
        ? inDaysWords(row.days, locale)
        : row.status === 'paid' && row.paidAt
          ? tx(I.paidOn, { date: date(row.paidAt) })
          : tx(I.today)
  const forWhom = row.child === null ? tx(I.family) : row.child.name ?? ''
  return (
    <tr className={`in-row in-row--${row.status}${opens ? ' in-row--opens' : ''}`}>
      <td className="in-td-payer">
        <div className="entity">
          <Avatar name={row.account.name} seed={row.account.id ?? row.family.id} size="sm" />
          <div className="entity__text">
            {row.account.id ? (
              <Link className="entity__name in-payer" to={parentPath(row.account.id)} aria-label={tx(I.openProfile, { name: row.account.name })}>
                <bdi>{row.account.name}</bdi>
              </Link>
            ) : (
              <span className="entity__name">
                <bdi>{row.account.name}</bdi>
              </span>
            )}
            {row.account.name !== row.family.name && (
              <span className="entity__sub">
                <bdi>{row.family.name}</bdi>
              </span>
            )}
          </div>
        </div>
      </td>
      <td className="in-td-for">
        <bdi>{forWhom}</bdi>
        {row.label && (
          <span className="in-sub">
            <bdi>{row.label}</bdi>
          </span>
        )}
      </td>
      <td className="in-td-plan">
        <PlanStrip row={row} plan={plan} view={view} />
      </td>
      <td className="in-td-due">
        <span className="in-when" title={day}>
          {when}
        </span>
        <time className="in-sub" dateTime={row.dueDate}>
          {day}
        </time>
      </td>
      <td className="in-td-amount">
        <Money amountMinor={row.amountMinor} currency={row.currency} />
      </td>
      <td className="in-td-status">
        <Badge tone={STATUS_TONE[row.status]} dot>
          {tx(STATUS_LABEL[row.status])}
        </Badge>
        {row.beforeGoLive && <span className="in-sub">{tx(I.beforeGoLiveBadge)}</span>}
      </td>
      <td className="in-td-sup">
        {row.responsibleSupervisor ? (
          <bdi>{row.responsibleSupervisor.name}</bdi>
        ) : (
          <span className="in-unset">{tx(row.responsibleBasis === 'child' ? I.unassignedChild : I.unassigned)}</span>
        )}
        <span className="in-sub in-basis">
          <span>{tx(row.responsibleBasis === 'child' ? I.childBasis : I.billingBasis)}</span>
          {canAssign && row.responsibleBasis === 'family' && (
            <button type="button" className="in-set" onClick={onAssign}>
              {tx(row.responsibleSupervisor ? I.changeSupervisor : I.setSupervisor)}
            </button>
          )}
        </span>
      </td>
      <td className="in-td-act">
        {row.conversationId ? (
          <Link
            className="btn btn--ghost btn--icon btn--sm in-chat"
            to={`/chat/${encodeURIComponent(row.conversationId)}`}
            aria-label={tx(I.open)}
            title={tx(I.open)}
          >
            <Icon name="conversations" size={18} />
          </Link>
        ) : (
          <span className="in-chat in-chat--none" title={tx(I.noConversation)}>
            <Icon name="conversations" size={18} />
            <span className="sr-only">{tx(I.noConversation)}</span>
          </span>
        )}
      </td>
    </tr>
  )
}
