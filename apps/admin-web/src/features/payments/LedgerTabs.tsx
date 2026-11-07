import { Fragment, useEffect, useId, useState, type ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Dialog } from '@/shared/components/Dialog'
import { FilterChips } from '@/shared/components/FilterChips'
import { SearchField } from '@/shared/components/SearchField'
import { SearchableSelect, type SelectOption } from '@/shared/components/SearchableSelect'
import { EmptyState, LoadingState, QueryBoundary } from '@/shared/components/States'
import { monthsLabel } from '@/features/subscriptions/copy'
import type {
  AttemptFilter,
  AttemptStatus,
  CardAttempt,
  CardAttemptRow,
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
} from './api'
import {
  ATTEMPT_FILTER,
  ATTEMPT_STATUS,
  EVENT_OUTCOME,
  EVENT_TYPES,
  LED,
  METHOD,
  PAY,
  PURPOSE_LABEL,
  TRANSACTION_STATUS,
  type Pair,
  attemptFailure,
  cardLabel,
  describeError,
  formatDay,
  formatMoney,
  useCopy,
} from './copy'
import {
  useCardAttempts,
  useReconcileNow,
  useReconcilePayment,
  useStripeEvents,
  useTransaction,
  useTransactions,
} from './hooks'
import { Field, InvoiceDownloadButton, RequestStatusBadge, ServerError } from './PaymentParts'
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

const STATUS_TONE: Record<TransactionStatus, Tone> = { standing: 'ok', partially_refunded: 'warn', refunded: 'outline', voided: 'outline' }
const ATTEMPT_TONE: Record<AttemptStatus, Tone> = { open: 'info', complete: 'ok', expired: 'outline', failed: 'danger' }
const OUTCOME_TONE: Record<string, Tone> = {
  recorded: 'ok',
  refund_recorded: 'ok',
  mismatch: 'danger',
  payment_failed: 'warn',
  checkout_failed: 'warn',
  refund_deferred: 'warn',
  unknown_session: 'warn',
}

const raw = (s: string): Pair => ({ en: s, ar: s })

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

function AttemptStatusBadge({ status }: { status: AttemptStatus }) {
  const tx = useCopy()
  return (
    <Badge tone={ATTEMPT_TONE[status] ?? 'outline'} dot>
      {tx(ATTEMPT_STATUS[status] ?? raw(status))}
    </Badge>
  )
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const tx = useCopy()
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

export function TransactionsTab() {
  const tx = useCopy()
  const { locale, number } = useI18n()
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
  const [openId, setOpenId] = useState<string | null>(null)
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const totals = list.data?.pages[0]?.totals ?? []
  const filtered = Boolean(status || method || purpose || plan || from || to || search)

  const clear = () => {
    setStatus('')
    setMethod('')
    setPurpose('')
    setPlan('')
    setFrom('')
    setTo('')
    setSearch('')
  }

  return (
    <>
      <section className="pay-filters" aria-label={tx(LED.filters)}>
        <div className="pay-filters__row">
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
            {(id) => <input id={id} className="input" type="date" dir="ltr" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />}
          </Field>
          <Field label={tx(LED.to)} error={rangeError ? tx(PAY.periodOrder) : null}>
            {(id, d) => (
              <input id={id} className="input" type="date" dir="ltr" value={to} min={from || undefined} aria-describedby={d} aria-invalid={rangeError || undefined} onChange={(e) => setTo(e.target.value)} />
            )}
          </Field>
        </div>
        <div className="pay-filters__row">
          <div className="pay-filters__search">
            <SearchField value={search} onChange={(v) => setSearch(v.slice(0, MAX_SEARCH))} label={tx(LED.search)} clearLabel={tx(LED.clearSearch)} />
          </div>
          {filtered && (
            <button type="button" className="btn btn--sm btn--ghost" onClick={clear}>
              {tx(LED.clearFilters)}
            </button>
          )}
        </div>
      </section>

      {list.error && rows.length === 0 ? (
        <EmptyState icon="alert" title={describeError(list.error, locale)} />
      ) : (
        <QueryBoundary isLoading={list.isLoading} error={null} onRetry={() => void list.refetch()}>
          {totals.length > 0 && (
            <section className="pay-totals-wrap" aria-label={tx(LED.totals)}>
              <ul className="pay-totals">
                {totals.map((t) => (
                  <li key={t.currency} className="card panel pay-total" aria-label={t.currency}>
                    <strong className="pay-total__currency">{t.currency}</strong>
                    <dl className="tf-kv">
                      <dt>{tx(LED.count)}</dt>
                      <dd className="pf-amount">{number(t.count)}</dd>
                      <dt>{tx(LED.totalAmount)}</dt>
                      <dd className="pf-amount">{formatMoney(t.amountMinor, t.currency, locale)}</dd>
                      <dt>{tx(LED.totalRefunded)}</dt>
                      <dd className="pf-amount">{formatMoney(t.refundedMinor, t.currency, locale)}</dd>
                      <dt>{tx(LED.net)}</dt>
                      <dd className="pf-amount">{formatMoney(t.netMinor, t.currency, locale)}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
              <p className="field__hint">{tx(LED.totalsHint)}</p>
            </section>
          )}
          {rows.length === 0 ? (
            !rangeError && <EmptyState title={tx(LED.noTransactions)} />
          ) : (
            <div className="table-wrap">
              <table className="table table--interactive pay-table" aria-label={tx(LED.transactions)}>
                <thead>
                  <tr>
                    <th scope="col">{tx(LED.colFamily)}</th>
                    <th scope="col">{tx(LED.colChild)}</th>
                    <th scope="col">{tx(LED.colFor)}</th>
                    <th scope="col">{tx(LED.colMethod)}</th>
                    <th scope="col" className="pay-num">{tx(LED.colAmount)}</th>
                    <th scope="col" className="pay-num">{tx(LED.colRefunded)}</th>
                    <th scope="col">{tx(LED.colStatus)}</th>
                    <th scope="col">{tx(LED.colPaidOn)}</th>
                    <th scope="col">{tx(LED.colInvoice)}</th>
                    <th scope="col">
                      <span className="sr-only">{tx(LED.details)}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <TransactionRow key={t.id} t={t} onOpen={() => setOpenId(t.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ServerError error={rows.length > 0 ? list.error : null} />
          <LoadMore query={list} />
        </QueryBoundary>
      )}
      {openId && <TransactionDetailDialog paymentId={openId} onClose={() => setOpenId(null)} />}
    </>
  )
}

function forWhat(request: Transaction['request'], locale: 'ar' | 'en', tx: ReturnType<typeof useCopy>) {
  if (!request) return null
  const parts = [tx(PURPOSE_LABEL[request.purpose] ?? raw(request.purpose))]
  if (request.planMonths) parts.push(monthsLabel(request.planMonths, locale))
  return parts.join(' · ')
}

function TransactionRow({ t, onOpen }: { t: Transaction; onOpen: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const money = (n: number) => formatMoney(n, t.currency, locale)
  const card = cardLabel(t.card)
  return (
    <tr className="pay-row" onClick={onOpen}>
      <td dir="auto">{t.family ? t.family.name : <span className="tf-muted">{tx(LED.beforeAssign)}</span>}</td>
      <td dir="auto">{t.child?.name ?? '—'}</td>
      <td>
        {t.request ? (
          <>
            <span dir="auto">{t.request.label}</span>
            <span className="pay-sub">{forWhat(t.request, locale, tx)}</span>
          </>
        ) : (
          '—'
        )}
      </td>
      <td>
        {tx(METHOD[t.method] ?? raw(t.method))}
        {card && (
          <bdi className="pay-sub" dir="ltr">
            {card}
          </bdi>
        )}
      </td>
      <td className="pay-num pf-amount">{money(t.amountMinor)}</td>
      <td className="pay-num">{t.refundedMinor > 0 ? money(t.refundedMinor) : '—'}</td>
      <td>
        <TransactionStatusBadge status={t.status} />
      </td>
      <td>{formatDay(t.paidOn, locale)}</td>
      <td>{t.invoice ? <bdi dir="ltr">{t.invoice.number}</bdi> : '—'}</td>
      <td>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          aria-label={tx(LED.detailsNamed, { amount: money(t.amountMinor), date: formatDay(t.paidOn, locale) })}
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
        >
          {tx(LED.details)}
        </button>
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
                {' · '}
                <bdi dir="ltr">{card}</bdi>
              </>
            )}
          </dd>
          <dt>{tx(LED.colAmount)}</dt>
          <dd className="pf-amount">{money(p.amountMinor)}</dd>
          <dt>{tx(LED.colRefunded)}</dt>
          <dd className="pf-amount">{money(p.refundedMinor)}</dd>
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
              <dd dir="auto">
                {dateTime(p.voided.at)}
                {p.voided.by ? ` · ${p.voided.by.name}` : ''}
                {p.voided.reason ? ` · ${p.voided.reason}` : ''}
              </dd>
            </>
          )}
        </dl>
      </Section>

      {p.stripe && (
        <Section title={tx(LED.stripeRefs)} aside={p.stripe.livemode === false ? <Badge tone="warn">{tx(LED.testMode)}</Badge> : undefined}>
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
                  <span className="pf-amount">{money(r.amountMinor)}</span>
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
            <dd className="pf-amount">{money(d.request.amountMinor, d.request.currency)}</dd>
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
                  {!e.livemode && <Badge tone="warn">{tx(LED.testMode)}</Badge>}
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
  const { locale, dateTime } = useI18n()
  return (
    <li className="pf-entry">
      <div className="pf-entry__head">
        <AttemptStatusBadge status={a.status} />
        <span className="pf-amount">{formatMoney(a.amountMinor, a.currency, locale)}</span>
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
  const { locale } = useI18n()
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
              <td className="pf-amount">{formatMoney(r.chat.amountMinor, r.chat.currency, locale)}</td>
              <td className="pf-amount">{formatMoney(r.stripe.amountReceivedMinor, r.stripe.currency, locale)}</td>
            </tr>
            <tr>
              <th scope="row">{tx(LED.amountRefunded)}</th>
              <td className="pf-amount">{formatMoney(r.chat.refundedMinor, r.chat.currency, locale)}</td>
              <td className="pf-amount">{formatMoney(r.stripe.amountRefundedMinor, r.stripe.currency, locale)}</td>
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
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <>
      <FilterChips<AttemptFilter> label={tx(PAY.status)} value={status} onChange={setStatus} options={ATTEMPT_FILTERS.map((s) => ({ value: s, label: tx(ATTEMPT_FILTER[s]) }))} />
      <p className="field__hint">{tx(LED.attemptsHint)}</p>
      {list.error && rows.length === 0 ? (
        <EmptyState icon="alert" title={describeError(list.error, locale)} />
      ) : (
        <QueryBoundary isLoading={list.isLoading} error={null} onRetry={() => void list.refetch()}>
          {rows.length === 0 ? (
            <EmptyState title={tx(LED.noCardAttempts)} />
          ) : (
            <div className="table-wrap">
              <table className="table pay-table" aria-label={tx(LED.attempts)}>
                <thead>
                  <tr>
                    <th scope="col">{tx(LED.colFamily)}</th>
                    <th scope="col">{tx(LED.colRequest)}</th>
                    <th scope="col" className="pay-num">{tx(LED.colAmount)}</th>
                    <th scope="col" className="pay-num">{tx(LED.colTries)}</th>
                    <th scope="col">{tx(LED.colWhy)}</th>
                    <th scope="col">{tx(LED.lastFailed)}</th>
                    <th scope="col">{tx(LED.colStatus)}</th>
                    <th scope="col">{tx(LED.colPaid)}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <AttemptRow key={a.sessionId} a={a} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ServerError error={rows.length > 0 ? list.error : null} />
          <LoadMore query={list} />
        </QueryBoundary>
      )}
    </>
  )
}

function AttemptRow({ a }: { a: CardAttemptRow }) {
  const tx = useCopy()
  const { locale, dateTime, number } = useI18n()
  return (
    <tr>
      <td dir="auto">{a.family ? a.family.name : <span className="tf-muted">{tx(LED.beforeAssign)}</span>}</td>
      <td>
        <span dir="auto">{a.request.label}</span>
        <span className="pay-sub">{tx(PURPOSE_LABEL[a.request.purpose] ?? raw(a.request.purpose))}</span>
      </td>
      <td className="pay-num pf-amount">{formatMoney(a.amountMinor, a.currency, locale)}</td>
      <td className="pay-num">{number(a.failureCount)}</td>
      <td>
        <FailureWords a={a} />
      </td>
      <td>{a.lastFailedAt ? dateTime(a.lastFailedAt) : '—'}</td>
      <td>
        <AttemptStatusBadge status={a.status} />
      </td>
      <td>
        <Badge tone={a.paymentId ? 'ok' : 'outline'}>{tx(a.paymentId ? LED.yes : LED.no)}</Badge>
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
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <>
      <section className="card panel tf-section" aria-labelledby="pay-reconcile-now">
        <div className="tf-section__head">
          <h2 id="pay-reconcile-now" className="tf-section__title">
            {tx(LED.reconcileNow)}
          </h2>
        </div>
        <p className="field__hint">{tx(LED.reconcileNowHint)}</p>
        <ServerError error={sweep.error} />
        <div className="tf-actions">
          <button type="button" className="btn btn--sm btn--primary" disabled={sweep.isPending} onClick={() => sweep.mutate()}>
            {sweep.isPending ? tx(LED.reconciling) : tx(LED.reconcileNow)}
          </button>
        </div>
        {sweep.data && <SweepResult r={sweep.data} />}
      </section>

      <p className="field__hint">{tx(LED.eventsHint)}</p>
      <section className="pay-filters" aria-label={tx(LED.filters)}>
        <div className="pay-filters__row">
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
        </div>
      </section>

      {list.error && rows.length === 0 ? (
        <EmptyState icon="alert" title={describeError(list.error, locale)} />
      ) : (
        <QueryBoundary isLoading={list.isLoading} error={null} onRetry={() => void list.refetch()}>
          {rows.length === 0 ? (
            <EmptyState title={tx(LED.noStripeEvents)} />
          ) : (
            <div className="table-wrap">
              <table className="table pay-table" aria-label={tx(LED.eventsTab)}>
                <thead>
                  <tr>
                    <th scope="col">{tx(LED.colReceived)}</th>
                    <th scope="col">{tx(LED.colType)}</th>
                    <th scope="col">{tx(LED.colOutcome)}</th>
                    <th scope="col">{tx(LED.colObject)}</th>
                    <th scope="col">{tx(LED.colMode)}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <EventRow key={e.id} e={e} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ServerError error={rows.length > 0 ? list.error : null} />
          <LoadMore query={list} />
        </QueryBoundary>
      )}
    </>
  )
}

function EventRow({ e }: { e: StripeEvent }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  return (
    <tr>
      <td>{dateTime(e.receivedAt)}</td>
      <td>
        <Code>{e.type}</Code>
      </td>
      <td>
        <OutcomeBadge outcome={e.outcome} />
      </td>
      <td>{e.objectId ? <Code>{e.objectId}</Code> : '—'}</td>
      <td>{e.livemode ? tx(LED.live) : <Badge tone="warn">{tx(LED.testMode)}</Badge>}</td>
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
