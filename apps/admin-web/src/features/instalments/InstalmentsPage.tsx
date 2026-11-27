import { useId, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { FilterChips } from '@/shared/components/FilterChips'
import type { MenuItem } from '@/shared/components/Menu'
import { PageHeader, type MastFigure } from '@/shared/components/PageHeader'
import { RowActions } from '@/shared/components/RowActions'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import type { Instalment, InstalmentStatus, Responsible } from './api'
import { GROUP_LABEL, I, OPEN_ONES, countWords, describeError, formatDay, inDaysWords, moneyParts, lateWords, useCopy } from './copy'
import { useInstalments } from './hooks'
import { BillingSupervisorDialog } from './BillingSupervisorDialog'
import { parentPath } from '@/features/profiles/api'
import { useFinanceFigures } from '@/features/payments/figures'
import { Money, sumByCurrency } from '@/features/payments/Money'
import './instalments.css'

/** The page's sections, in the order the server lists them: what is late leads. */
const GROUPS: readonly InstalmentStatus[] = ['overdue', 'due', 'upcoming', 'paid']
/** A long section opens on its first rows; the rest wait behind "Show all". */
const FOLD_AFTER = 8

/** The rows of one plan: a family's own instalments, or one child's. */
const planKey = (row: Instalment) => `${row.family.id}:${row.child ? (row.child.id ?? '?') : 'family'}`
type PlanView = 'whole' | 'open' | 'part'

/**
 * PD-12 S3: Instalment Payments, grouped by urgency. The masthead says what is
 * late, due today, upcoming and collected; under it one section per state, in
 * the server's order (overdue oldest first, due today, upcoming soonest), of
 * the instalments recorded in Chat (PD-17) for the families this viewer may
 * see. A row opens the payer's Parent Profile -- where payments are recorded;
 * the family's conversation and the billing supervisor (the Operations Manager
 * and the super admin set it) are behind the row's menu.
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
  const planView: PlanView = filtered ? 'part' : paid ? 'whole' : 'open'

  const figures = useFinanceFigures()
  const mast = [figures.late, figures.dueToday, figures.upcoming, linked(figures.collected, figures.paymentsPath && `${figures.paymentsPath}?tab=transactions`)].filter(
    (f): f is MastFigure => f !== null,
  )

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
        <PageHeader
          eyebrow={eyebrow}
          title={tx(I.title)}
          subtitle={tx(I.subtitle)}
          status={
            data && data.counts.unassigned > 0 ? (
              // The same count the screen reader's line carries, below.
              <span aria-hidden="true">
                <Badge tone="warn">{tx(I.countsUnassigned, { n: data.counts.unassigned })}</Badge>
              </span>
            ) : undefined
          }
          figures={mast}
        />
        <div className="sheet in-bar">
          <div className="sheet-bar" role="group" aria-label={tx(I.filters)}>
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
            <label className="in-check" title={data?.lockFrom ? tx(I.beforeGoLiveHint, { date: formatDay(data.lockFrom, locale) }) : undefined}>
              <input type="checkbox" checked={beforeGoLive} onChange={(e) => setBeforeGoLive(e.target.checked)} />
              {tx(I.beforeGoLive)}
              {data?.counts.beforeGoLive ? ` (${data.counts.beforeGoLive})` : ''}
            </label>
            {/* What the plan marks mean. Each strip also says it in words. */}
            <p className="sheet-bar__end plan-key" aria-hidden="true">
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
            </p>
          </div>
          {beforeGoLive && data?.lockFrom && <p className="in-bar__note">{tx(I.beforeGoLiveHint, { date: formatDay(data.lockFrom, locale) })}</p>}
        </div>
        {list.error ? (
          <EmptyState icon="alert" title={describeError(list.error, locale)} />
        ) : (
          <QueryBoundary isLoading={list.isLoading} error={null} onRetry={() => void list.refetch()}>
            {
              <>
                {data && (
                  // The masthead shows these counts; this line says them to a screen reader.
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
                  GROUPS.map((status) => (
                    <Group
                      key={status}
                      status={status}
                      rows={data.items.filter((r) => r.status === status)}
                      plans={plans}
                      view={planView}
                      canAssign={data.canAssignBillingSupervisor}
                      onAssign={setAssigning}
                    />
                  ))
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

/** A masthead figure that leads somewhere, when this account may go there. */
function linked(figure: MastFigure | null, to: string | null | false): MastFigure | null {
  return figure && to ? { ...figure, to } : figure
}

/**
 * One state's instalments on their own sheet: its name, how many (a solid
 * counter, solid red for what is late), what they add up to, then the rows.
 */
function Group({
  status,
  rows,
  plans,
  view,
  canAssign,
  onAssign,
}: {
  status: InstalmentStatus
  rows: Instalment[]
  plans: Map<string, Instalment[]>
  view: PlanView
  canAssign: boolean
  onAssign: (row: Instalment) => void
}) {
  const tx = useCopy()
  const { number } = useI18n()
  const id = useId()
  const [all, setAll] = useState(false)
  if (rows.length === 0) return null
  const shown = all || rows.length <= FOLD_AFTER ? rows : rows.slice(0, FOLD_AFTER)
  const sums = sumByCurrency(rows)
  const counter = status === 'overdue' ? 'count count--urgent' : status === 'due' ? 'count' : 'count count--quiet'
  return (
    <section className={`sheet in-group in-group--${status}`} aria-labelledby={id}>
      <div className="sheet__head">
        <h2 className="sheet__title in-group__title">
          <span id={id}>{tx(GROUP_LABEL[status])}</span>
          <span className={counter}>{number(rows.length)}</span>
        </h2>
        <span className="in-group__sum">
          {sums.map((s) => (
            <Money key={s.currency} amountMinor={s.amountMinor} currency={s.currency} size="sm" />
          ))}
        </span>
      </div>
      <ul className="in-rows">
        {shown.map((row) => (
          <Row key={row.id} row={row} plan={plans.get(planKey(row)) ?? [row]} view={view} canAssign={canAssign} onAssign={() => onAssign(row)} />
        ))}
      </ul>
      {shown.length < rows.length && (
        <button type="button" className="in-group__more" onClick={() => setAll(true)}>
          {tx(I.showAllN, { n: number(rows.length) })}
        </button>
      )}
    </section>
  )
}

/**
 * One mark per instalment of the plan that this list holds: paid, late, due
 * today, still to come. The row's own instalment stands taller.
 */
function PlanStrip({ row, plan, view }: { row: Instalment; plan: Instalment[]; view: PlanView }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const at = plan.findIndex((r) => r.id === row.id) + 1
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
  // "Instalment 2 of 4: 1 paid, 1 late, 2 to come". Without the paid instalments the list
  // holds only what is still open: it says so, never "2 of 4".
  const label = `${tx(view === 'whole' ? I.planLabel : I.planOpenLabel, { i: at, n: plan.length })}: ${said}`
  // What is still owed on the plan, from the rows this list holds (never a total it cannot see).
  const left = view === 'part' || plan.length < 2 ? [] : sumByCurrency(plan.filter((r) => r.status !== 'paid'))
  return (
    <span className="plan">
      <span className="plan__line" role="img" aria-label={label} title={label}>
        <span className="plan__ticks">
          {plan.map((r) => (
            <span key={r.id} className={`plan__tick plan__tick--${r.status}${r.id === row.id ? ' plan__tick--here' : ''}`} />
          ))}
        </span>
        {view === 'whole' ? (
          <span className="plan__at">{tx(I.planOf, { i: at, n: plan.length })}</span>
        ) : view === 'open' ? (
          <span className="plan__at">{countWords(plan.length, OPEN_ONES, locale)}</span>
        ) : null}
      </span>
      {left.length > 0 && (
        <span className="plan__left">
          {left.map((s) => (
            <span key={s.currency} className="plan__left-sum">
              {/* The currency after the number, as on every amount on the page. */}
              {tx(I.leftOnPlan, { amount: `\u2068${moneyParts(s.amountMinor, s.currency, locale).number} ${moneyParts(s.amountMinor, s.currency, locale).unit}\u2069` })}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

/**
 * An instalment: who pays and what it is for; its plan; who follows it; its age
 * in words (the fact that matters on a late row); the amount at the row's end;
 * then the one thing done most, opening the Parent Profile where a payment is recorded.
 */
function Row({ row, plan, view, canAssign, onAssign }: { row: Instalment; plan: Instalment[]; view: PlanView; canAssign: boolean; onAssign: () => void }) {
  const tx = useCopy()
  const { locale, date } = useI18n()
  const navigate = useNavigate()
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
  const conversationId = row.conversationId
  const more: MenuItem[] = []
  if (conversationId) more.push({ key: 'chat', label: tx(I.open), icon: 'conversations', onSelect: () => navigate(`/chat/${encodeURIComponent(conversationId)}`) })
  if (canAssign && row.responsibleBasis === 'family') {
    more.push({ key: 'supervisor', label: tx(row.responsibleSupervisor ? I.changeSupervisor : I.setSupervisor), icon: 'userCheck', onSelect: onAssign })
  }
  return (
    <li className={`in-row in-row--${row.status}`}>
      <div className="in-row__who entity" title={row.account.name !== row.family.name ? row.family.name : undefined}>
        <Avatar name={row.account.name} seed={row.account.id ?? row.family.id} size="sm" />
        <div className="entity__text">
          <span className="entity__name">
            <bdi>{row.account.name}</bdi>
          </span>
          <span className="entity__sub">
            <bdi>{forWhom}</bdi>
            {row.label && (
              <>
                {locale === 'ar' ? '، ' : ', '}
                <bdi>{row.label}</bdi>
              </>
            )}
          </span>
        </div>
      </div>
      <div className="in-row__plan">
        <PlanStrip row={row} plan={plan} view={view} />
      </div>
      <div className="in-row__sup">
        {row.responsibleSupervisor ? <bdi>{row.responsibleSupervisor.name}</bdi> : <span className="in-unset">{tx(row.responsibleBasis === 'child' ? I.unassignedChild : I.unassigned)}</span>}
        <span className="in-sub">{tx(row.responsibleBasis === 'child' ? I.childBasis : I.billingBasis)}</span>
      </div>
      <div className="in-row__when">
        <span className="in-when">{when}</span>
        <span className="in-sub">
          <time dateTime={row.dueDate}>{day}</time>
          {row.beforeGoLive && <span className="in-row__flag">{tx(I.beforeGoLiveBadge)}</span>}
        </span>
      </div>
      <div className="in-row__amount">
        <Money amountMinor={row.amountMinor} currency={row.currency} />
      </div>
      <div className="in-row__act">
        {!conversationId && <span className="sr-only">{tx(I.noConversation)}</span>}
        <RowActions
          primary={
            row.account.id ? (
              <Link className="btn btn--sm" to={parentPath(row.account.id)} aria-label={tx(I.openProfile, { name: row.account.name })}>
                {tx(I.openFile)}
              </Link>
            ) : undefined
          }
          more={more}
          label={tx(I.more, { name: row.account.name })}
        />
      </div>
    </li>
  )
}
