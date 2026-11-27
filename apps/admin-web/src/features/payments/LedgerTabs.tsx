import { Fragment, useEffect, useId, useState, type ReactNode } from 'react'
import { ACADEMY_ZONE, isoToAcademyWallClock } from '@/core/time/academyTime'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Dialog } from '@/shared/components/Dialog'
import { FilterChips } from '@/shared/components/FilterChips'
import { Icon, type IconName } from '@/shared/components/Icon'
import type { MenuItem } from '@/shared/components/Menu'
import { RowActions } from '@/shared/components/RowActions'
import { SearchField } from '@/shared/components/SearchField'
import { SearchableSelect, type SelectOption } from '@/shared/components/SearchableSelect'
import { EmptyState, LoadingState, QueryBoundary } from '@/shared/components/States'
import { monthsLabel } from '@/features/subscriptions/copy'
import type {
  AttemptFilter,
  AttemptStatus,
  CardAttempt,
  CardAttemptRow,
  Overpaid,
  PaymentMethod,
  PaymentReconciliation,
  PlanMonths,
  ReconcileSweepResult,
  RequestPurpose,
  RequestStatus,
  StripeEvent,
  StripeRefs,
  Transaction,
  TransactionDetail,
  TransactionFilters,
  TransactionStatus,
  TransactionTotal,
} from './api'
import {
  ATTEMPT_FILTER,
  ATTEMPT_STATUS,
  EVENT_OUTCOME,
  EVENT_TYPES,
  LED,
  METHOD,
  OVERPAID_WHY,
  PAY,
  PURPOSE_LABEL,
  TRANSACTION_STATUS,
  type Pair,
  attemptFailure,
  cardLabel,
  dayHeading,
  describeError,
  formatDay,
  formatMoney,
  moneyParts,
  paymentCreditsLessons,
  useCopy,
} from './copy'
import { FailedTag, Money, sumByCurrency } from './Money'
import {
  useCardAttempts,
  useDownloadInvoice,
  useReconcileNow,
  useReconcilePayment,
  useStripeEvents,
  useTransaction,
  useTransactions,
} from './hooks'
import { Field, InvoiceDownloadButton, RefundNote, RequestStatusBadge, ServerError } from './PaymentParts'
import './payments.css'

/**
 * PD-27 completion (docs/admin/pd027-stripe-lifecycle.md §3.6): the academy's
 * money as one ledger. Transactions (filters, totals per currency, a detail
 * sheet with Stripe's references and Reconcile), Card attempts (declined,
 * failed and abandoned), and the Stripe webhook log. Everything here is read
 * from the server in the viewer's family scope; Reconcile and the event log
 * are offered only on the server's `canReconcile` (canVerify), and the server
 * decides each request again.
 */

const STATUSES: readonly TransactionStatus[] = ['standing', 'partially_refunded', 'refunded', 'voided']
const METHODS: readonly PaymentMethod[] = ['card', 'bank_transfer', 'cash', 'invoice']
const PURPOSES: readonly RequestPurpose[] = ['subscription', 'renewal', 'instalment', 'balance', 'other']
const PLANS: readonly PlanMonths[] = [1, 3, 6, 12]
const ATTEMPT_FILTERS: readonly AttemptFilter[] = ['failed', 'open', 'expired', 'complete', 'all']
/** The server caps the search at 100 characters. */
const MAX_SEARCH = 100

/*
 * Three state colours only. Done is green; waiting (open, to look at again) is
 * amber; what a person must act on now is the solid urgent tag; what failed and
 * asks nothing more is the red dot (FailedTag), so "failed" never reads as "urgent".
 */
const STATUS_TONE: Record<TransactionStatus, Tone> = { standing: 'ok', partially_refunded: 'info', refunded: 'neutral', voided: 'neutral' }
const ATTEMPT_TONE: Record<Exclude<AttemptStatus, 'failed'>, Tone> = { open: 'waiting', complete: 'ok', expired: 'neutral' }
/** Outcomes that went wrong and are over: Stripe said no, nothing is left to do here. */
const FAILED_OUTCOMES: ReadonlySet<string> = new Set(['payment_failed', 'checkout_failed'])
const OUTCOME_TONE: Record<string, Tone> = {
  recorded: 'ok',
  refund_recorded: 'ok',
  mismatch: 'danger',
  refund_deferred: 'warn',
  unknown_session: 'warn',
  refund_failed_after_record: 'danger',
  // A dispute is a flag for a person (the ledger is unchanged): opened and money withdrawn are urgent.
  dispute_opened: 'danger',
  dispute_funds_withdrawn: 'danger',
  dispute_closed_lost: 'danger',
  dispute_updated: 'warn',
  dispute_closed_unknown: 'warn',
  dispute_closed_won: 'ok',
  dispute_closed_prevented: 'ok',
  dispute_funds_reinstated: 'ok',
}

const raw = (s: string): Pair => ({ en: s, ar: s })

const METHOD_ICON: Record<PaymentMethod, IconName> = { card: 'card', bank_transfer: 'bankTransfer', cash: 'cash', invoice: 'invoice' }

/** Rows gathered under the day they belong to; days in the order they first appear. */
function byDay<T>(rows: readonly T[], dayOf: (row: T) => string): Array<{ day: string; rows: T[] }> {
  const days: Array<{ day: string; rows: T[] }> = []
  const at = new Map<string, T[]>()
  for (const row of rows) {
    const day = dayOf(row)
    let list = at.get(day)
    if (!list) {
      list = []
      at.set(day, list)
      days.push({ day, rows: list })
    }
    list.push(row)
  }
  return days
}

/**
 * A day's heading across a ledger: the day in words; what the day came to, where
 * that is known, sits in the amount column (the one before the actions) so the
 * day's sum lines up with the amounts under it.
 */
function DayRow({ day, span, children }: { day: string; span: number; children?: ReactNode }) {
  const { locale } = useI18n()
  if (!children) {
    return (
      <tr className="tx-day">
        <th scope="rowgroup" colSpan={span}>
          <span className="tx-day__name">{dayHeading(day, locale)}</span>
        </th>
      </tr>
    )
  }
  return (
    <tr className="tx-day">
      <th scope="rowgroup" colSpan={span - 2}>
        <span className="tx-day__name">{dayHeading(day, locale)}</span>
      </th>
      <td className="tx-day__sum tx-end">{children}</td>
      <td className="tx-day__pad" />
    </tr>
  )
}

/** Whether the filter fields are unfolded: the person's own choice, kept on this browser. */
const FILTERS_OPEN_KEY = 'jawwid.payments.filters-open'
function readFiltersOpen(): boolean {
  try {
    return localStorage.getItem(FILTERS_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function TransactionStatusBadge({ status }: { status: TransactionStatus }) {
  const tx = useCopy()
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {tx(TRANSACTION_STATUS[status])}
    </Badge>
  )
}

/** M3: money recorded beyond what was owed -- staff refund it or credit it. */
function OverpaidBadge({ overpaid }: { overpaid: Overpaid }) {
  const tx = useCopy()
  return (
    <Badge tone={overpaid.settled ? 'neutral' : 'danger'}>
      {tx(overpaid.settled ? LED.overpaidSettled : LED.overpaid)}
    </Badge>
  )
}

function AttemptStatusBadge({ status }: { status: AttemptStatus }) {
  const tx = useCopy()
  if (status === 'failed') return <FailedTag>{tx(ATTEMPT_STATUS.failed)}</FailedTag>
  return (
    <Badge tone={ATTEMPT_TONE[status] ?? 'neutral'} dot>
      {tx(ATTEMPT_STATUS[status] ?? raw(status))}
    </Badge>
  )
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const tx = useCopy()
  if (FAILED_OUTCOMES.has(outcome)) return <FailedTag title={outcome}>{tx(EVENT_OUTCOME[outcome] ?? raw(outcome))}</FailedTag>
  return (
    <Badge tone={OUTCOME_TONE[outcome] ?? 'neutral'}>
      <span title={outcome}>{tx(EVENT_OUTCOME[outcome] ?? raw(outcome))}</span>
    </Badge>
  )
}

/** A Stripe id, as written (never translated, never mirrored). */
function Code({ children }: { children: ReactNode }) {
  return (
    <code className="pay-code" dir="ltr">
      {children}
    </code>
  )
}

/** Copy one value; say plainly when the browser would not let us. */
function CopyValueButton({ value, label }: { value: string; label: string }) {
  const tx = useCopy()
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('failed')
    }
  }
  return (
    <>
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => void copy()} aria-label={tx(LED.copyNamed, { label })}>
        {tx(LED.copy)}
      </button>
      {state !== 'idle' && (
        <span className={state === 'copied' ? 'sp-ok' : 'field__error'} role="status">
          {tx(state === 'copied' ? PAY.copied : LED.copyValueFailed)}
        </span>
      )}
    </>
  )
}

function LoadMore({ query }: { query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown } }) {
  const tx = useCopy()
  if (!query.hasNextPage) return null
  return (
    <div className="pay-more">
      <button type="button" className="btn btn--sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
        {query.isFetchingNextPage ? tx(LED.loading) : tx(LED.loadMore)}
      </button>
    </div>
  )
}

/** A picker of fixed choices with an "any" first: '' sends nothing. */
function Picker({ label, value, onChange, any, options }: { label: string; value: string; onChange: (v: string) => void; any: string; options: SelectOption[] }) {
  return (
    <Field label={label}>
      {(id) => <SearchableSelect id={id} className="select" value={value} onValueChange={onChange} options={[{ value: '', label: any }, ...options]} />}
    </Field>
  )
}

// ---- Transactions ---------------------------------------------------------

export function TransactionsTab({ onSeeReceipts }: { onSeeReceipts?: () => void } = {}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const [status, setStatus] = useState<TransactionStatus | ''>('')
  const [method, setMethod] = useState<PaymentMethod | ''>('')
  const [purpose, setPurpose] = useState<RequestPurpose | ''>('')
  const [plan, setPlan] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim(), 300)
  const rangeError = from !== '' && to !== '' && from > to
  const filters: TransactionFilters = { status, method, purpose, planMonths: plan ? (Number(plan) as PlanMonths) : '', from, to, q }
  const list = useTransactions(filters, !rangeError)
  const download = useDownloadInvoice()
  const [openId, setOpenId] = useState<string | null>(null)
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const totals = list.data?.pages[0]?.totals ?? []
  const filtered = Boolean(status || method || purpose || plan || from || to || search)
  // The six fields fold behind one control; what is set stays in view as chips. A wrong range is never hidden.
  const [filtersOpen, setFiltersOpen] = useState(readFiltersOpen)
  const fieldsShown = filtersOpen || rangeError
  const toggleFilters = () => {
    const next = !filtersOpen
    setFiltersOpen(next)
    try {
      localStorage.setItem(FILTERS_OPEN_KEY, next ? '1' : '0')
    } catch {
      // Storage blocked: the fields still fold for this visit.
    }
  }
  const set: Array<{ key: string; text: string; clear: () => void }> = []
  if (status) set.push({ key: 'status', text: `${tx(PAY.status)}: ${tx(TRANSACTION_STATUS[status])}`, clear: () => setStatus('') })
  if (method) set.push({ key: 'method', text: `${tx(PAY.method)}: ${tx(METHOD[method])}`, clear: () => setMethod('') })
  if (purpose) set.push({ key: 'purpose', text: `${tx(PAY.purpose)}: ${tx(PURPOSE_LABEL[purpose])}`, clear: () => setPurpose('') })
  if (plan) set.push({ key: 'plan', text: `${tx(LED.planMonths)}: ${monthsLabel(Number(plan), locale)}`, clear: () => setPlan('') })
  if (from) set.push({ key: 'from', text: `${tx(LED.from)}: ${formatDay(from, locale)}`, clear: () => setFrom('') })
  if (to) set.push({ key: 'to', text: `${tx(LED.to)}: ${formatDay(to, locale)}`, clear: () => setTo('') })

  const clear = () => {
    setStatus('')
    setMethod('')
    setPurpose('')
    setPlan('')
    setFrom('')
    setTo('')
    setSearch('')
  }

  const days = byDay(rows, (t) => t.paidOn)

  return (
    <>
      <div className="sheet tx-sheet">
        <section className="tx-filters" aria-label={tx(LED.filters)}>
          <div className="sheet-bar">
            <SearchField value={search} onChange={(v) => setSearch(v.slice(0, MAX_SEARCH))} label={tx(LED.search)} clearLabel={tx(LED.clearSearch)} />
            <button type="button" className="btn btn--sm tx-filters__toggle" aria-expanded={fieldsShown} aria-controls="pay-filter-fields" onClick={toggleFilters}>
              <Icon name="filter" size={16} />
              {set.length > 0 ? tx(LED.filtersOn, { n: set.length }) : tx(LED.filters)}
            </button>
            {set.map((f) => (
              <span key={f.key} className="tx-set">
                <span>{f.text}</span>
                <button type="button" className="tx-set__x" onClick={f.clear} aria-label={tx(LED.removeFilter, { label: f.text })} title={tx(LED.removeFilter, { label: f.text })}>
                  <Icon name="close" size={13} />
                </button>
              </span>
            ))}
            {filtered && (
              <button type="button" className="btn btn--sm btn--ghost" onClick={clear}>
                {tx(LED.clearFilters)}
              </button>
            )}
          </div>
          <div id="pay-filter-fields" className="tx-filters__fields" hidden={!fieldsShown}>
            <Picker
              label={tx(PAY.status)}
              value={status}
              onChange={(v) => setStatus(v as TransactionStatus | '')}
              any={tx(LED.anyStatus)}
              options={STATUSES.map((s) => ({ value: s, label: tx(TRANSACTION_STATUS[s]) }))}
            />
            <Picker
              label={tx(PAY.method)}
              value={method}
              onChange={(v) => setMethod(v as PaymentMethod | '')}
              any={tx(LED.anyMethod)}
              options={METHODS.map((m) => ({ value: m, label: tx(METHOD[m]) }))}
            />
            <Picker
              label={tx(PAY.purpose)}
              value={purpose}
              onChange={(v) => setPurpose(v as RequestPurpose | '')}
              any={tx(LED.anyPurpose)}
              options={PURPOSES.map((p) => ({ value: p, label: tx(PURPOSE_LABEL[p]) }))}
            />
            <Picker
              label={tx(LED.planMonths)}
              value={plan}
              onChange={setPlan}
              any={tx(LED.anyPlan)}
              options={PLANS.map((m) => ({ value: String(m), label: monthsLabel(m, locale) }))}
            />
            <Field label={tx(LED.from)}>
              {(id) => <input id={id} className="input" type="date" dir="ltr" value={from} max={to || undefined} data-empty={from === '' || undefined} onChange={(e) => setFrom(e.target.value)} />}
            </Field>
            <Field label={tx(LED.to)} error={rangeError ? tx(PAY.periodOrder) : null}>
              {(id, d) => (
                <input id={id} className="input" type="date" dir="ltr" value={to} min={from || undefined} data-empty={to === '' || undefined} aria-describedby={d} aria-invalid={rangeError || undefined} onChange={(e) => setTo(e.target.value)} />
              )}
            </Field>
          </div>
        </section>

        {list.error && rows.length === 0 ? (
          <EmptyState icon="alert" title={describeError(list.error, locale)} />
        ) : (
          <QueryBoundary isLoading={list.isLoading} error={null} onRetry={() => void list.refetch()}>
            {rows.length === 0 ? (
              !rangeError &&
              (filtered ? (
                <EmptyState
                  title={tx(LED.noTransactions)}
                  hint={tx(LED.noTransactionsFiltered)}
                  action={
                    <button type="button" className="btn btn--sm" onClick={clear}>
                      {tx(LED.clearFilters)}
                    </button>
                  }
                />
              ) : (
                <EmptyState
                  title={tx(LED.noTransactions)}
                  hint={tx(LED.noTransactionsHint)}
                  action={
                    onSeeReceipts && (
                      <button type="button" className="btn btn--sm" onClick={onSeeReceipts}>
                        {tx(LED.seeReceipts)}
                      </button>
                    )
                  }
                />
              ))
            ) : (
              <table className="table table--interactive tx-table tx-table--payments" aria-label={tx(LED.transactions)}>
                <thead>
                  <tr>
                    <th scope="col">{tx(LED.colFamily)}</th>
                    <th scope="col">{tx(LED.colFor)}</th>
                    <th scope="col">{tx(LED.colMethod)}</th>
                    <th scope="col">{tx(LED.colInvoice)}</th>
                    <th scope="col" className="tx-end">
                      {tx(LED.colAmount)}
                    </th>
                    <th scope="col" className="cell-actions">
                      <span className="sr-only">{tx(LED.details)}</span>
                    </th>
                  </tr>
                </thead>
                {days.map((d, i) => (
                  <tbody key={d.day}>
                    <DayRow day={d.day} span={6}>
                      {/* The last day shown may have more rows on the next page: its sum waits for them. */}
                      {!(list.hasNextPage && i === days.length - 1) && <DayNet rows={d.rows} />}
                    </DayRow>
                    {d.rows.map((t) => (
                      <TransactionRow key={t.id} t={t} onOpen={() => setOpenId(t.id)} onInvoice={(id) => download.mutate(id)} />
                    ))}
                  </tbody>
                ))}
              </table>
            )}
            <ServerError error={download.error ?? (rows.length > 0 ? list.error : null)} />
            <LoadMore query={list} />
          </QueryBoundary>
        )}
        {totals.length > 0 && <Totals totals={totals} />}
      </div>
      {openId && <TransactionDetailDialog paymentId={openId} onClose={() => setOpenId(null)} />}
    </>
  )
}

/** What a day came to: what stands of each payment, less its refunds, per currency. A voided payment adds nothing. */
function DayNet({ rows }: { rows: Transaction[] }) {
  const tx = useCopy()
  const sums = sumByCurrency(rows.filter((t) => t.status !== 'voided').map((t) => ({ amountMinor: t.amountMinor - t.refundedMinor, currency: t.currency })))
  if (sums.length === 0) return null
  return (
    <span className="tx-day__net">
      <span className="tx-day__k">{tx(LED.net)}</span>
      {sums.map((s) => (
        <Money key={s.currency} amountMinor={s.amountMinor} currency={s.currency} size="sm" />
      ))}
    </span>
  )
}

function forWhat(request: Transaction['request'], locale: 'ar' | 'en', tx: ReturnType<typeof useCopy>) {
  if (!request) return null
  const parts = [tx(PURPOSE_LABEL[request.purpose] ?? raw(request.purpose))]
  if (request.planMonths) parts.push(monthsLabel(request.planMonths, locale))
  const said = parts.join(locale === 'ar' ? '، ' : ', ')
  // A label that already says it ("Balance") needs no second line.
  return said.trim() === request.label.trim() ? null : said
}

/**
 * What matches the filters, at the foot of the sheet and in view while it
 * scrolls: one line per currency, written as the sum it is. Received, less
 * what was refunded, leaves the net. The currency names the line, so the
 * figures on it carry no symbol of their own.
 */
function Totals({ totals }: { totals: TransactionTotal[] }) {
  const tx = useCopy()
  const { locale, number } = useI18n()
  return (
    <section className="tx-totals" aria-label={tx(LED.totals)} title={tx(LED.totalsHint)}>
      <span className="tx-totals__name">{tx(LED.totals)}</span>
      <ul className="tx-totals__lines">
        {totals.map((t) => {
          const figure = (n: number) => moneyParts(n, t.currency, locale).number
          // The line is named the way every amount on the page names its currency.
          const name = moneyParts(0, t.currency, locale).unit
          return (
            <li key={t.currency} className="pay-sum__line" aria-label={name}>
              <span className="pay-sum__currency" dir="auto">
                {name}
              </span>
              <span className="pay-sum__term pay-sum__term--count">
                <span className="pay-sum__k">{tx(LED.count)}</span>
                <span className="pay-sum__v" dir="ltr">
                  {number(t.count)}
                </span>
              </span>
              <span className="pay-sum__term">
                <span className="pay-sum__k">{tx(LED.totalAmount)}</span>
                <span className="pay-sum__v" dir="ltr">
                  {figure(t.amountMinor)}
                </span>
              </span>
              <span className="pay-sum__op" aria-hidden="true">
                −
              </span>
              <span className="pay-sum__term">
                <span className="pay-sum__k">{tx(LED.totalRefunded)}</span>
                <span className="pay-sum__v" dir="ltr">
                  {figure(t.refundedMinor)}
                </span>
              </span>
              <span className="pay-sum__op" aria-hidden="true">
                =
              </span>
              {/* The net stands under the amount column, digits on its edge, its currency beside them. */}
              <span className="pay-sum__term pay-sum__term--net">
                <span className="pay-sum__k">{tx(LED.net)}</span>
                <Money amountMinor={t.netMinor} currency={t.currency} />
              </span>
            </li>
          )
        })}
      </ul>
      <p className="sr-only">{tx(LED.totalsHint)}</p>
    </section>
  )
}

/** Who a row is about: a monogram and the family, with the child beneath when the row names one. */
function FamilyCell({ family, child, seed }: { family: { id: string; name: string } | null; child?: { name: string } | null; seed: string }) {
  const tx = useCopy()
  return (
    <div className="entity">
      <Avatar name={family?.name ?? ''} seed={family?.id ?? seed} size="sm" />
      <div className="entity__text">
        {family ? (
          <span className="entity__name">
            <bdi>{family.name}</bdi>
          </span>
        ) : (
          <span className="pay-quiet">{tx(LED.beforeAssign)}</span>
        )}
        {child && (
          <span className="entity__sub">
            <bdi>{child.name}</bdi>
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * A payment: who paid, what for, how, its invoice, then the amount at the
 * row's end with where it stands. One action opens it; the invoice is behind the menu.
 */
function TransactionRow({ t, onOpen, onInvoice }: { t: Transaction; onOpen: () => void; onInvoice: (invoiceId: string) => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const money = (n: number) => formatMoney(n, t.currency, locale)
  const card = cardLabel(t.card)
  const invoice = t.invoice
  const more: MenuItem[] = invoice ? [{ key: 'invoice', label: tx(PAY.downloadNamed, { number: invoice.number }), icon: 'fileArrowDown', onSelect: () => onInvoice(invoice.id) }] : []
  return (
    <tr className={t.status === 'voided' ? 'pay-row pay-row--voided' : 'pay-row'} onClick={onOpen}>
      <td className="tx-c-who">
        <FamilyCell family={t.family} child={t.child} seed={t.id} />
      </td>
      <td className="tx-c-for">
        {t.request ? (
          <>
            <bdi>{t.request.label}</bdi>
            {forWhat(t.request, locale, tx) && <span className="pay-sub">{forWhat(t.request, locale, tx)}</span>}
          </>
        ) : (
          <span className="pay-quiet">{tx(LED.noRequestShort)}</span>
        )}
      </td>
      <td className="tx-c-method">
        <span className="tx-method">
          <Icon name={METHOD_ICON[t.method] ?? 'cash'} size={17} />
          <span>{tx(METHOD[t.method] ?? raw(t.method))}</span>
        </span>
        {card && (
          <span className="pay-sub tx-method__card">
            <bdi dir="ltr">{card}</bdi>
          </span>
        )}
      </td>
      <td className="tx-c-ref">{invoice ? <bdi className="pay-invoice" dir="ltr">{invoice.number}</bdi> : <span className="pay-quiet">{tx(LED.noInvoice)}</span>}</td>
      <td className="tx-c-amount tx-end">
        <Money amountMinor={t.amountMinor} currency={t.currency} />
        <span className="tx-states">
          {t.refundedMinor > 0 && (
            <span className="pay-sub pay-refunded">
              <span>{tx(LED.refundedInline)}</span>
              <Money amountMinor={t.refundedMinor} currency={t.currency} size="sm" />
            </span>
          )}
          <TransactionStatusBadge status={t.status} />
          {t.overpaid && <OverpaidBadge overpaid={t.overpaid} />}
        </span>
      </td>
      <td className="cell-actions">
        <RowActions
          primary={
            <button
              type="button"
              className="btn btn--sm"
              aria-label={tx(LED.detailsNamed, { amount: money(t.amountMinor), date: formatDay(t.paidOn, locale) })}
              onClick={(e) => {
                e.stopPropagation()
                onOpen()
              }}
            >
              {tx(LED.open)}
            </button>
          }
          more={more}
          label={tx(LED.more, { name: t.family?.name ?? money(t.amountMinor) })}
        />
      </td>
    </tr>
  )
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  const id = useId()
  return (
    <section className="tf-section pay-detail__section" aria-labelledby={id}>
      <div className="tf-section__head">
        <h3 id={id} className="tf-section__title">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** One payment, its Stripe references, refunds, request, card attempts and webhook events. */
function TransactionDetailDialog({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const one = useTransaction(paymentId)
  const d = one.data
  const title = d ? tx(LED.detailTitle, { amount: formatMoney(d.payment.amountMinor, d.payment.currency, locale) }) : tx(LED.details)
  return (
    <Dialog variant="sheet" title={title} onClose={onClose}>
      {one.error ? (
        <EmptyState icon="alert" title={describeError(one.error, locale)} />
      ) : !d ? (
        <LoadingState />
      ) : (
        <TransactionDetailBody d={d} />
      )}
    </Dialog>
  )
}

const REFS: ReadonlyArray<{ key: Exclude<keyof StripeRefs, 'livemode'>; label: Pair }> = [
  { key: 'checkoutSessionId', label: LED.checkoutSession },
  { key: 'paymentIntentId', label: LED.paymentIntent },
  { key: 'chargeId', label: LED.charge },
  { key: 'customerId', label: LED.customer },
]

function TransactionDetailBody({ d }: { d: TransactionDetail }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const p = d.payment
  const money = (n: number, currency = p.currency) => formatMoney(n, currency, locale)
  const card = cardLabel(p.card)
  const refs = p.stripe ? REFS.filter((r) => p.stripe![r.key]) : []
  return (
    <div className="pay-detail">
      <Section title={tx(LED.summary)} aside={<TransactionStatusBadge status={p.status} />}>
        <dl className="tf-kv">
          <dt>{tx(LED.colFamily)}</dt>
          <dd dir="auto">{p.family ? p.family.name : tx(LED.beforeAssign)}</dd>
          {p.child && (
            <>
              <dt>{tx(LED.colChild)}</dt>
              <dd dir="auto">{p.child.name}</dd>
            </>
          )}
          <dt>{tx(LED.colMethod)}</dt>
          <dd>
            {tx(METHOD[p.method] ?? raw(p.method))}
            {card && (
              <>
                {locale === 'ar' ? '، ' : ', '}
                <bdi dir="ltr">{card}</bdi>
              </>
            )}
          </dd>
          <dt>{tx(LED.colAmount)}</dt>
          <dd>
            <Money amountMinor={p.amountMinor} currency={p.currency} />
          </dd>
          <dt>{tx(LED.colRefunded)}</dt>
          <dd>
            <Money amountMinor={p.refundedMinor} currency={p.currency} />
          </dd>
          {p.overpaid && (
            <>
              <dt>
                <OverpaidBadge overpaid={p.overpaid} />
              </dt>
              <dd>
                <span className="pf-amount">{tx(LED.overpaidBy, { amount: money(p.overpaid.amountMinor) })}</span>
                {OVERPAID_WHY[p.overpaid.why] && <span className="pay-sub">{tx(OVERPAID_WHY[p.overpaid.why]!)}</span>}
              </dd>
            </>
          )}
          <dt>{tx(LED.colPaidOn)}</dt>
          <dd>{formatDay(p.paidOn, locale)}</dd>
          <dt>{tx(LED.recordedAt)}</dt>
          <dd>{dateTime(p.recordedAt)}</dd>
          <dt>{tx(LED.recordedBy)}</dt>
          <dd dir="auto">{p.recordedBy ? p.recordedBy.name : tx(PAY.byStripe)}</dd>
          {p.invoice && (
            <>
              <dt>{tx(LED.colInvoice)}</dt>
              <dd className="pay-inline">
                <bdi dir="ltr">{p.invoice.number}</bdi>
                <InvoiceDownloadButton invoiceId={p.invoice.id} number={p.invoice.number} />
              </dd>
            </>
          )}
          {p.reference && (
            <>
              <dt>{tx(PAY.reference)}</dt>
              <dd>
                <bdi dir="ltr">{p.reference}</bdi>
              </dd>
            </>
          )}
          {p.voided && (
            <>
              <dt>{tx(LED.voided)}</dt>
              <dd>
                <span className="pay-why">
                  <span>{dateTime(p.voided.at)}</span>
                  {p.voided.by && <bdi>{tx(LED.voidedBy, { name: p.voided.by.name })}</bdi>}
                  {p.voided.reason && <bdi className="pay-sub">{p.voided.reason}</bdi>}
                </span>
              </dd>
            </>
          )}
        </dl>
        {p.refundedMinor > 0 && (
          <RefundNote
            as="p"
            wording={
              paymentCreditsLessons({ trialId: p.trialId, instalmentId: p.instalmentId, purpose: p.request?.purpose ?? d.request?.purpose ?? null })
                ? 'lessons'
                : 'plain'
            }
            amountMinor={p.refundedMinor}
            currency={p.currency}
          />
        )}
      </Section>

      {p.stripe && (
        <Section title={tx(LED.stripeRefs)} aside={p.stripe.livemode === false ? <Badge tone="neutral">{tx(LED.testMode)}</Badge> : undefined}>
          <dl className="tf-kv pay-refs">
            {refs.map((r) => (
              <Fragment key={r.key}>
                <dt>{tx(r.label)}</dt>
                <dd className="pay-inline">
                  <Code>{p.stripe![r.key]}</Code>
                  <CopyValueButton value={p.stripe![r.key]!} label={tx(r.label)} />
                </dd>
              </Fragment>
            ))}
          </dl>
        </Section>
      )}

      {d.canReconcile && <ReconcilePanel paymentId={p.id} />}

      <Section title={tx(LED.refunds)}>
        {d.refunds.length === 0 ? (
          <p className="tf-muted">{tx(LED.noRefunds)}</p>
        ) : (
          <ol className="pf-timeline" aria-label={tx(LED.refunds)}>
            {d.refunds.map((r) => (
              <li key={r.id} className="pf-entry">
                <div className="pf-entry__head">
                  <Money amountMinor={r.amountMinor} currency={p.currency} />
                  <span className="tf-muted">{dateTime(r.at)}</span>
                  <span className="tf-muted" dir="auto">
                    {r.source === 'stripe' ? tx(PAY.refundStripe) : r.recordedBy ? tx(LED.refundBy, { name: r.recordedBy.name }) : tx(PAY.refundStaff)}
                  </span>
                </div>
                {r.reason && (
                  <p className="pf-entry__meta" dir="auto">
                    {r.reason}
                  </p>
                )}
                {r.stripeRefundId && (
                  <p className="pf-entry__meta">
                    <Code>{r.stripeRefundId}</Code>
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title={tx(LED.request)} aside={d.request ? <RequestStatusBadge status={d.request.status as RequestStatus} /> : undefined}>
        {!d.request ? (
          <p className="tf-muted">{tx(LED.noRequest)}</p>
        ) : (
          <dl className="tf-kv">
            <dt>{tx(PAY.label)}</dt>
            <dd dir="auto">{d.request.label}</dd>
            <dt>{tx(PAY.purpose)}</dt>
            <dd>{tx(PURPOSE_LABEL[d.request.purpose] ?? raw(d.request.purpose))}</dd>
            <dt>{tx(PAY.amount)}</dt>
            <dd>
              <Money amountMinor={d.request.amountMinor} currency={d.request.currency} />
            </dd>
            {d.request.planMonths && (
              <>
                <dt>{tx(LED.planMonths)}</dt>
                <dd>{monthsLabel(d.request.planMonths, locale)}</dd>
              </>
            )}
            {d.request.periodStart && d.request.periodEnd && (
              <>
                <dt>{tx(PAY.periodStart)}</dt>
                <dd>{tx(PAY.period, { from: formatDay(d.request.periodStart, locale), to: formatDay(d.request.periodEnd, locale) })}</dd>
              </>
            )}
          </dl>
        )}
      </Section>

      <Section title={tx(LED.attempts)}>
        {d.attempts.length === 0 ? (
          <p className="tf-muted">{tx(LED.noAttempts)}</p>
        ) : (
          <ol className="pf-timeline" aria-label={tx(LED.attempts)}>
            {d.attempts.map((a) => (
              <AttemptEntry key={a.sessionId} a={a} />
            ))}
          </ol>
        )}
      </Section>

      <Section title={tx(LED.events)}>
        {d.events.length === 0 ? (
          <p className="tf-muted">{tx(LED.noEvents)}</p>
        ) : (
          <ol className="pf-timeline" aria-label={tx(LED.events)}>
            {d.events.map((e) => (
              <li key={e.id} className="pf-entry">
                <div className="pf-entry__head">
                  <Code>{e.type}</Code>
                  <OutcomeBadge outcome={e.outcome} />
                  {!e.livemode && <Badge tone="neutral">{tx(LED.testMode)}</Badge>}
                </div>
                <p className="pf-entry__meta">{dateTime(e.receivedAt)}</p>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  )
}

/** Why an attempt failed, in words, and Stripe's raw code beside it for staff. */
function FailureWords({ a }: { a: Pick<CardAttempt, 'failureCode' | 'failureCount' | 'status'> }) {
  const tx = useCopy()
  const words = attemptFailure(a)
  if (!words) return <>—</>
  return (
    <span className="pay-why">
      <span>{tx(words)}</span>
      {a.failureCode && (
        <span className="pay-sub">
          {tx(LED.rawCode)}: <Code>{a.failureCode}</Code>
        </span>
      )}
    </span>
  )
}

function AttemptEntry({ a }: { a: CardAttempt }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  return (
    <li className="pf-entry">
      <div className="pf-entry__head">
        <AttemptStatusBadge status={a.status} />
        <Money amountMinor={a.amountMinor} currency={a.currency} />
        <span className="tf-muted">{tx(LED.attemptOpened, { date: dateTime(a.createdAt) })}</span>
      </div>
      {(a.failureCount > 0 || a.failureCode) && (
        <p className="pf-entry__meta">
          <span>{tx(LED.declines, { n: a.failureCount })}</span>
          {a.lastFailedAt && <span>{tx(LED.lastFailedAt, { date: dateTime(a.lastFailedAt) })}</span>}
        </p>
      )}
      <div className="pf-entry__meta">
        <FailureWords a={a} />
      </div>
      <p className="pf-entry__meta">
        <Code>{a.sessionId}</Code>
      </p>
    </li>
  )
}

function ReconcilePanel({ paymentId }: { paymentId: string }) {
  const tx = useCopy()
  const reconcile = useReconcilePayment()
  return (
    <Section title={tx(LED.reconcile)}>
      <p className="field__hint">{tx(LED.reconcileHint)}</p>
      <ServerError error={reconcile.error} />
      <div className="tf-actions">
        <button type="button" className="btn btn--sm btn--primary" disabled={reconcile.isPending} onClick={() => reconcile.mutate(paymentId)}>
          {reconcile.isPending ? tx(LED.reconciling) : tx(LED.reconcile)}
        </button>
      </div>
      {reconcile.data && <ReconcileResult r={reconcile.data} />}
    </Section>
  )
}

function ReconcileResult({ r }: { r: PaymentReconciliation }) {
  const tx = useCopy()
  return (
    <div className={r.inSync ? 'banner banner--info pay-result' : 'banner banner--warn pay-result'} role="status">
      <p className="pay-result__lead">{tx(r.inSync ? LED.inSync : LED.outOfSync)}</p>
      {!r.inSync && (
        <table className="table pay-compare">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">{tx(LED.colAmount)}</span>
              </th>
              <th scope="col">{tx(LED.chatSide)}</th>
              <th scope="col">{tx(LED.stripeSide)}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{tx(LED.amountReceived)}</th>
              <td>
                <Money amountMinor={r.chat.amountMinor} currency={r.chat.currency} />
              </td>
              <td>
                <Money amountMinor={r.stripe.amountReceivedMinor} currency={r.stripe.currency} />
              </td>
            </tr>
            <tr>
              <th scope="row">{tx(LED.amountRefunded)}</th>
              <td>
                <Money amountMinor={r.chat.refundedMinor} currency={r.chat.currency} />
              </td>
              <td>
                <Money amountMinor={r.stripe.amountRefundedMinor} currency={r.stripe.currency} />
              </td>
            </tr>
            <tr>
              <th scope="row">{tx(LED.stripeStatus)}</th>
              <td>—</td>
              <td>
                <Code>{r.stripe.status}</Code>
              </td>
            </tr>
          </tbody>
        </table>
      )}
      <p className="pay-result__lead">{tx(LED.refundsRecorded, { n: r.recordedRefunds })}</p>
    </div>
  )
}

// ---- Card attempts --------------------------------------------------------

export function AttemptsTab() {
  const tx = useCopy()
  const { locale } = useI18n()
  const [status, setStatus] = useState<AttemptFilter>('failed')
  const list = useCardAttempts(status)
  const [openPayment, setOpenPayment] = useState<string | null>(null)
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const days = byDay(rows, (a) => isoToAcademyWallClock(a.createdAt, ACADEMY_ZONE).date)
  return (
    <>
      <div className="sheet tx-sheet">
        <div className="sheet-bar">
          <FilterChips<AttemptFilter> label={tx(PAY.status)} value={status} onChange={setStatus} options={ATTEMPT_FILTERS.map((s) => ({ value: s, label: tx(ATTEMPT_FILTER[s]) }))} />
        </div>
        {list.error && rows.length === 0 ? (
          <EmptyState icon="alert" title={describeError(list.error, locale)} />
        ) : (
          <QueryBoundary isLoading={list.isLoading} error={null} onRetry={() => void list.refetch()}>
            {rows.length === 0 ? (
              <EmptyState
                title={tx(LED.noCardAttempts)}
                hint={tx(status === 'failed' ? LED.noFailedAttemptsHint : LED.noAttemptsHint)}
                action={
                  status !== 'all' && (
                    <button type="button" className="btn btn--sm" onClick={() => setStatus('all')}>
                      {tx(LED.showAllAttempts)}
                    </button>
                  )
                }
              />
            ) : (
              <table className="table tx-table tx-table--attempts" aria-label={tx(LED.attempts)}>
                <thead>
                  <tr>
                    <th scope="col">{tx(LED.colFamily)}</th>
                    <th scope="col">{tx(LED.colWhy)}</th>
                    <th scope="col">{tx(LED.colStatus)}</th>
                    <th scope="col" className="tx-end">
                      {tx(LED.colAmount)}
                    </th>
                    <th scope="col" className="cell-actions">
                      <span className="sr-only">{tx(LED.summary)}</span>
                    </th>
                  </tr>
                </thead>
                {days.map((d) => (
                  <tbody key={d.day}>
                    <DayRow day={d.day} span={5} />
                    {d.rows.map((a) => (
                      <AttemptRow key={a.sessionId} a={a} onOpenPayment={setOpenPayment} />
                    ))}
                  </tbody>
                ))}
              </table>
            )}
            <ServerError error={rows.length > 0 ? list.error : null} />
            <LoadMore query={list} />
          </QueryBoundary>
        )}
        <p className="tx-foot">{tx(LED.attemptsHint)}</p>
      </div>
      {openPayment && <TransactionDetailDialog paymentId={openPayment} onClose={() => setOpenPayment(null)} />}
    </>
  )
}

/**
 * A card attempt: whose and for which request; what happened, in words; where
 * it stands and whether it was paid; the amount. A paid one opens its payment.
 */
function AttemptRow({ a, onOpenPayment }: { a: CardAttemptRow; onOpenPayment: (paymentId: string) => void }) {
  const tx = useCopy()
  const { time, number } = useI18n()
  const paymentId = a.paymentId
  return (
    <tr>
      <td className="tx-c-who">
        <div className="entity">
          <Avatar name={a.family?.name ?? ''} seed={a.family?.id ?? a.sessionId} size="sm" />
          <div className="entity__text">
            {a.family ? (
              <span className="entity__name">
                <bdi>{a.family.name}</bdi>
              </span>
            ) : (
              <span className="pay-quiet">{tx(LED.beforeAssign)}</span>
            )}
            <span className="entity__sub">
              <bdi>{a.request.label}</bdi>
              {/* The purpose, unless the label already says it ("Renewal, 1 month"). */}
              {!a.request.label.toLocaleLowerCase().includes(tx(PURPOSE_LABEL[a.request.purpose] ?? raw(a.request.purpose)).toLocaleLowerCase()) && (
                <span className="pay-purpose">{tx(PURPOSE_LABEL[a.request.purpose] ?? raw(a.request.purpose))}</span>
              )}
            </span>
          </div>
        </div>
      </td>
      <td className="tx-c-why">
        <FailureWords a={a} />
        <span className="pay-sub tx-declines">
          {/* No decline is no news. */}
          {a.failureCount > 0 && (
            <span>
              {tx(LED.colTries)} <span className="pay-count">{number(a.failureCount)}</span>
            </span>
          )}
          {/* The day heads the group: the time is enough. */}
          {a.lastFailedAt && <span>{tx(LED.lastFailedAt, { date: time(a.lastFailedAt) })}</span>}
        </span>
      </td>
      <td className="tx-c-state">
        <AttemptStatusBadge status={a.status} />
        {/* The second fact, apart from the attempt's own status: was the money paid in the end. */}
        <span className="pay-sub tx-paid">
          {tx(LED.colPaid)}:{' '}
          <strong className={paymentId ? 'tx-paid__yes' : 'tx-paid__no'}>{tx(paymentId ? LED.yes : LED.no)}</strong>
        </span>
      </td>
      <td className="tx-c-amount tx-end">
        <Money amountMinor={a.amountMinor} currency={a.currency} />
      </td>
      <td className="cell-actions">
        <RowActions
          primary={
            paymentId ? (
              <button type="button" className="btn btn--sm" onClick={() => onOpenPayment(paymentId)}>
                {tx(LED.openPayment)}
              </button>
            ) : undefined
          }
          label={tx(LED.more, { name: a.family?.name ?? a.request.label })}
        />
      </td>
    </tr>
  )
}

// ---- Stripe events (canReconcile) -----------------------------------------

export function StripeEventsTab() {
  const tx = useCopy()
  const { locale } = useI18n()
  const [outcome, setOutcome] = useState('')
  const [type, setType] = useState('')
  const list = useStripeEvents({ outcome, type })
  const sweep = useReconcileNow()
  const hintId = useId()
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const days = byDay(rows, (e) => isoToAcademyWallClock(e.receivedAt, ACADEMY_ZONE).date)
  return (
    <div className="sheet tx-sheet">
      <section className="sheet-bar tx-bar--fields" aria-label={tx(LED.filters)}>
        <Picker
          label={tx(LED.outcome)}
          value={outcome}
          onChange={setOutcome}
          any={tx(LED.anyOutcome)}
          options={Object.entries(EVENT_OUTCOME).map(([value, label]) => ({ value, label: tx(label), hint: value }))}
        />
        <Picker
          label={tx(LED.type)}
          value={type}
          onChange={setType}
          any={tx(LED.anyType)}
          options={EVENT_TYPES.map((t) => ({ value: t, label: t.endsWith('.') ? `${t}*` : t }))}
        />
        <div className="sheet-bar__end">
          {/* The tab's one act. What it does is said to whoever asks (its title, and to a screen reader). */}
          <button type="button" className="btn btn--primary" disabled={sweep.isPending} onClick={() => sweep.mutate()} title={tx(LED.reconcileNowHint)} aria-describedby={hintId}>
            <Icon name="refresh" size={16} />
            {sweep.isPending ? tx(LED.reconciling) : tx(LED.reconcileNow)}
          </button>
          <span id={hintId} className="sr-only">
            {tx(LED.reconcileNowHint)}
          </span>
        </div>
      </section>
      {(sweep.error || sweep.data) && (
        <div className="tx-sweep">
          <ServerError error={sweep.error} />
          {sweep.data && <SweepResult r={sweep.data} />}
        </div>
      )}

      {list.error && rows.length === 0 ? (
        <EmptyState icon="alert" title={describeError(list.error, locale)} />
      ) : (
        <QueryBoundary isLoading={list.isLoading} error={null} onRetry={() => void list.refetch()}>
          {rows.length === 0 ? (
            <EmptyState
              title={tx(LED.noStripeEvents)}
              hint={tx(outcome || type ? LED.noStripeEventsFiltered : LED.noStripeEventsHint)}
              action={
                (outcome || type) && (
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => {
                      setOutcome('')
                      setType('')
                    }}
                  >
                    {tx(LED.clearFilters)}
                  </button>
                )
              }
            />
          ) : (
            <table className="table tx-table tx-table--events" aria-label={tx(LED.eventsTab)}>
              <thead>
                <tr>
                  <th scope="col">{tx(LED.colReceived)}</th>
                  <th scope="col">{tx(LED.colType)}</th>
                  <th scope="col">{tx(LED.colOutcome)}</th>
                  <th scope="col">{tx(LED.colObject)}</th>
                  <th scope="col">{tx(LED.colMode)}</th>
                </tr>
              </thead>
              {days.map((d) => (
                <tbody key={d.day}>
                  <DayRow day={d.day} span={5} />
                  {d.rows.map((e) => (
                    <EventRow key={e.id} e={e} />
                  ))}
                </tbody>
              ))}
            </table>
          )}
          <ServerError error={rows.length > 0 ? list.error : null} />
          <LoadMore query={list} />
        </QueryBoundary>
      )}
      <p className="tx-foot">{tx(LED.eventsHint)}</p>
    </div>
  )
}

/** A message from Stripe: when, what it was, what Chat did with it, the object it names. */
function EventRow({ e }: { e: StripeEvent }) {
  const tx = useCopy()
  const { time, dateTime } = useI18n()
  return (
    <tr>
      <td className="tx-c-time">
        <time dateTime={e.receivedAt} title={dateTime(e.receivedAt)}>
          {time(e.receivedAt)}
        </time>
      </td>
      <td className="tx-c-type">
        <Code>{e.type}</Code>
      </td>
      <td className="tx-c-outcome">
        <OutcomeBadge outcome={e.outcome} />
      </td>
      <td className="tx-c-object">{e.objectId ? <Code>{e.objectId}</Code> : <span className="pay-quiet">—</span>}</td>
      <td className="tx-c-mode">{e.livemode ? tx(LED.live) : <Badge tone="neutral">{tx(LED.testMode)}</Badge>}</td>
    </tr>
  )
}

function SweepResult({ r }: { r: ReconcileSweepResult }) {
  const tx = useCopy()
  const { number } = useI18n()
  const items: Array<[Pair, number]> = [
    [LED.sweepChecked, r.checked],
    [LED.sweepRecorded, r.recorded],
    [LED.sweepExpired, r.expired],
    [LED.sweepRefunds, r.refundsRecorded],
    [LED.sweepErrors, r.errors],
  ]
  return (
    <div className={r.errors > 0 ? 'banner banner--warn pay-result' : 'banner banner--info pay-result'} role="status">
      <p className="pay-result__lead">{tx(LED.sweepDone)}</p>
      <dl className="tf-kv">
        {items.map(([label, n]) => (
          <Fragment key={label.en}>
            <dt>{tx(label)}</dt>
            <dd className="pf-amount">{number(n)}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  )
}
