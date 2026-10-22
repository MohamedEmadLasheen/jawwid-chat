import { useState, type ReactNode } from 'react'
import { LOCALE_TAG, useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { Dialog } from '@/shared/components/Dialog'
import { QueryBoundary } from '@/shared/components/States'
import type { PayAdjustment, PayoutDetails, PayoutMethod, SalaryType, TeacherFile, TeacherFinance } from './api'
import { useCopy, type Pair } from './copy'
import { useCalendarDate } from './calendar'
import { useAddAdjustment, useRevealPayoutAccount, useSetPayoutAccount, useSetTerms, useTeacherFinance } from './hooks'
import { P, describePayrollError } from './payrollCopy'
import { Field, Footer } from './TeacherFileDialogs'

/**
 * PD-18 on the Teacher File: employment for every reader; salary terms, the
 * payment method, the financial summary and every amount for the super admin
 * only (`access.canViewFinance`, re-checked by the server on every route).
 * The page lays out what the server computed and adds nothing up itself.
 */

type Dialogs =
  | { kind: 'terms' }
  | { kind: 'payout' }
  | { kind: 'reveal' }
  | { kind: 'amount'; adjustmentKind: 'bonus' | 'deduction'; bonusEntryId?: string; violationId?: string; replaces?: PayAdjustment; title: string }
  | null

/** One finance read and one dialog for every payroll section on the page. */
export function usePayroll(file: TeacherFile) {
  const allowed = Boolean(file.access.canViewFinance)
  const query = useTeacherFinance(file.teacher.id, '', allowed)
  const [dialog, setDialog] = useState<Dialogs>(null)
  const finance = allowed ? query.data : undefined
  const dialogs =
    dialog && finance ? <PayrollDialog teacherId={file.teacher.id} finance={finance} dialog={dialog} onClose={() => setDialog(null)} /> : null
  return { allowed, query, finance, open: setDialog, dialogs }
}

export type Payroll = ReturnType<typeof usePayroll>

export function EmploymentSection({ file, payroll, onEdit }: { file: TeacherFile; payroll: Payroll; onEdit: () => void }) {
  return <Employment file={file} finance={payroll.finance} onEdit={onEdit} onOpen={payroll.open} />
}

export function FinancialSummarySection({ payroll }: { payroll: Payroll }) {
  if (!payroll.allowed) return null
  const q = payroll.query
  return (
    <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
      {payroll.finance && <Summary finance={payroll.finance} />}
    </QueryBoundary>
  )
}

export function HistorySection({ kind, file, payroll }: { kind: 'bonus' | 'deduction'; file: TeacherFile; payroll: Payroll }) {
  return <History kind={kind} file={file} finance={payroll.finance} onOpen={payroll.open} />
}

function Section({ id, title, hint, action, children }: { id: string; title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card panel tf-section" aria-labelledby={id}>
      <div className="tf-section__head">
        <h2 id={id} className="tf-section__title">{title}</h2>
        {action && <div className="tf-actions">{action}</div>}
      </div>
      {hint && <p className="tf-muted">{hint}</p>}
      {children}
    </section>
  )
}

/** "1,500.00 EGP" in the reader's language; an unknown currency code still shows the amount. */
export function useMoney() {
  const { locale } = useI18n()
  return (amount: string | null, currency: string | null) => {
    if (amount === null || currency === null) return locale === 'ar' ? P.none.ar : P.none.en
    try {
      return new Intl.NumberFormat(LOCALE_TAG[locale], { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number(amount))
    } catch {
      return `${amount} ${currency}`
    }
  }
}

function Employment({
  file,
  finance,
  onEdit,
  onOpen,
}: {
  file: TeacherFile
  finance?: TeacherFinance
  onEdit: () => void
  onOpen: (d: Dialogs) => void
}) {
  const tx = useCopy()
  const money = useMoney()
  const cal = useCalendarDate()
  const terms = finance?.currentTerms ?? null
  const account = finance?.payoutAccount ?? null
  const missing = <span className="tf-muted">{tx(P.none)}</span>
  return (
    <Section
      id="tf-employment"
      title={tx(P.employment)}
      action={
        <>
          {file.access.canEditPersonal && (
            <button type="button" className="btn btn--sm" onClick={onEdit}>{tx({ en: 'Edit', ar: 'تعديل' })}</button>
          )}
          {finance && (
            <button type="button" className="btn btn--sm" onClick={() => onOpen({ kind: 'terms' })}>{tx(P.setTerms)}</button>
          )}
        </>
      }
    >
      <dl className="tf-kv">
        <dt>{tx(P.teachingMarket)}</dt>
        <dd dir="auto">{file.employment?.teachingMarket ?? missing}</dd>
        <dt>{tx(P.currentStudents)}</dt>
        <dd>{file.employment?.studentCount ?? file.assignedStudents.length}</dd>
        {finance && (
          <>
            <dt>{tx(P.salaryType)}</dt>
            <dd>{terms ? tx(terms.salaryType === 'shift' ? P.shift : P.hourly) : <span className="tf-muted">{tx(P.noTerms)}</span>}</dd>
            <dt>{tx(P.currency)}</dt>
            <dd>{terms ? <bdi dir="ltr">{terms.currency}</bdi> : missing}</dd>
            <dt>{tx(terms?.salaryType === 'hourly' ? P.hourlyRate : P.monthlySalary)}</dt>
            <dd>
              {terms ? (
                <>
                  <bdi>{money(terms.monthlyAmount ?? terms.hourlyRate, terms.currency)}</bdi>
                  {terms.salaryType === 'hourly' && <span className="tf-muted"> · {tx(P.hourlyMonthly)}</span>}
                  <span className="tf-byline"> · {tx(P.effectiveFrom, { month: cal.month(terms.effectiveMonth) })}</span>
                </>
              ) : (
                missing
              )}
            </dd>
            <dt>{tx(P.payout)}</dt>
            <dd>
              {account ? (
                <>
                  {tx(P[account.method])} <span className="tf-muted">{tx(P.endingIn, { last4: account.last4 })}</span>
                </>
              ) : (
                <span className="tf-muted">{tx(P.noPayout)}</span>
              )}
              <span className="tf-actions tf-inline-actions">
                {finance.keyConfigured && (
                  <button type="button" className="btn btn--sm" onClick={() => onOpen({ kind: 'payout' })}>{tx(P.setPayout)}</button>
                )}
                {finance.keyConfigured && account && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => onOpen({ kind: 'reveal' })}>{tx(P.reveal)}</button>
                )}
              </span>
            </dd>
          </>
        )}
      </dl>
      {finance && !finance.keyConfigured && <div className="banner banner--info" role="status">{tx(P.noKey)}</div>}
      {finance && <p className="tf-byline">{tx(P.financeOnly)}</p>}
    </Section>
  )
}

function Summary({ finance }: { finance: TeacherFinance }) {
  const tx = useCopy()
  const money = useMoney()
  const cal = useCalendarDate()
  const { number } = useI18n()
  return (
    <Section id="tf-summary" title={tx(P.summary)} hint={tx(P.summaryHint)}>
      <div className="table-wrap tf-table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{tx(P.month)}</th>
              <th scope="col">{tx(P.base)}</th>
              <th scope="col">{tx(P.bonuses)}</th>
              <th scope="col">{tx(P.deductions)}</th>
              <th scope="col">{tx(P.net)}</th>
            </tr>
          </thead>
          <tbody>
            {finance.summary.map((m) => (
              <tr key={m.month}>
                <th scope="row">{cal.month(m.month)}</th>
                <td>
                  {money(m.base, m.currency)}
                  {m.salaryType === 'hourly' && (
                    <span className="tf-muted tf-kpi__hint"> {tx(P.paidHours, { h: number(Math.round((m.paidMinutes / 60) * 10) / 10) })}</span>
                  )}
                </td>
                <td>{m.currency ? money(m.bonuses, m.currency) : tx(P.none)}</td>
                <td>{m.currency ? money(m.deductions, m.currency) : tx(P.none)}</td>
                <td><strong>{money(m.net, m.currency)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

interface HistoryRow {
  key: string
  date: string
  reason: string
  by: string
  live: PayAdjustment | null
  source: { bonusEntryId?: string; violationId?: string } | null
}

function History({ kind, file, finance, onOpen }: { kind: 'bonus' | 'deduction'; file: TeacherFile; finance?: TeacherFinance; onOpen: (d: Dialogs) => void }) {
  const tx = useCopy()
  const money = useMoney()
  const { dateTime } = useI18n()
  const cal = useCalendarDate()
  const live = (finance?.adjustments ?? []).filter((a) => a.live && a.kind === kind)
  const recorded: HistoryRow[] =
    kind === 'bonus'
      ? (file.history?.bonuses ?? []).map((b) => ({
          key: b.id,
          date: dateTime(b.createdAt),
          reason: b.reason,
          by: b.author.name,
          live: live.find((a) => a.bonusEntryId === b.id) ?? null,
          source: { bonusEntryId: b.id },
        }))
      : (file.history?.deductions ?? []).map((d) => ({
          key: d.id,
          date: cal.month(d.month),
          reason: [tx(P[d.step]), d.note].filter(Boolean).join(' — '),
          by: d.author.name,
          live: live.find((a) => a.violationId === d.id) ?? null,
          source: { violationId: d.id },
        }))
  const standalone: HistoryRow[] = live
    .filter((a) => !a.bonusEntryId && !a.violationId)
    .map((a) => ({ key: a.id, date: cal.month(a.month), reason: a.reason, by: `${a.createdBy.name} · ${tx(P.standalone)}`, live: a, source: null }))
  const rows = [...recorded, ...standalone]
  const title = tx(kind === 'bonus' ? P.bonusHistory : P.deductionHistory)

  return (
    <Section
      id={`tf-${kind}-history`}
      title={title}
      hint={tx(kind === 'bonus' ? P.bonusHistoryHint : P.deductionHistoryHint)}
      action={
        finance && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => onOpen({ kind: 'amount', adjustmentKind: kind, title: tx(kind === 'bonus' ? P.addBonus : P.addDeduction) })}
          >
            {tx(kind === 'bonus' ? P.addBonus : P.addDeduction)}
          </button>
        )
      }
    >
      {rows.length === 0 ? (
        <p className="tf-muted">{tx(kind === 'bonus' ? P.noBonuses : P.noDeductions)}</p>
      ) : (
        <div className="table-wrap tf-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{tx(P.date)}</th>
                <th scope="col">{tx(P.reason)}</th>
                <th scope="col">{tx(P.by)}</th>
                {finance && <th scope="col">{tx(P.amount)}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.date}</td>
                  <td dir="auto">{r.reason}</td>
                  <td dir="auto">{r.by}</td>
                  {finance && (
                    <td>
                      {r.live === null ? (
                        <Badge tone="warn" dot>{tx(P.notPriced)}</Badge>
                      ) : r.live.amount === '0.00' ? (
                        <Badge tone="outline">{tx(P.cancelled)}</Badge>
                      ) : (
                        <strong>{money(r.live.amount, r.live.currency)}</strong>
                      )}{' '}
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() =>
                          onOpen(
                            r.live
                              ? { kind: 'amount', adjustmentKind: kind, replaces: r.live, title: `${tx(P.correct)} — ${r.reason}` }
                              : { kind: 'amount', adjustmentKind: kind, ...r.source, title: `${tx(P.setAmount)} — ${r.reason}` },
                          )
                        }
                      >
                        {tx(r.live ? P.correct : P.setAmount)}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function PayrollDialog({ teacherId, finance, dialog, onClose }: { teacherId: string; finance: TeacherFinance; dialog: NonNullable<Dialogs>; onClose: () => void }) {
  switch (dialog.kind) {
    case 'terms':
      return <TermsDialog teacherId={teacherId} finance={finance} onClose={onClose} />
    case 'payout':
      return <PayoutDialog teacherId={teacherId} onClose={onClose} />
    case 'reveal':
      return <RevealDialog teacherId={teacherId} onClose={onClose} />
    case 'amount':
      return <AmountDialog teacherId={teacherId} dialog={dialog} onClose={onClose} />
  }
}

function PayrollError({ error }: { error: unknown }) {
  const { locale } = useI18n()
  if (!error) return null
  return <div className="banner banner--danger" role="alert">{describePayrollError(error, locale)}</div>
}

function Select<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: Array<[V, Pair]>; onChange: (v: V) => void }) {
  const tx = useCopy()
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value as V)}>
        {options.map(([v, p]) => <option key={v} value={v}>{tx(p)}</option>)}
      </select>
    </label>
  )
}

function TermsDialog({ teacherId, finance, onClose }: { teacherId: string; finance: TeacherFinance; onClose: () => void }) {
  const tx = useCopy()
  const save = useSetTerms(teacherId)
  const current = finance.currentTerms
  const [salaryType, setSalaryType] = useState<SalaryType>(current?.salaryType ?? 'shift')
  const [effectiveMonth, setEffectiveMonth] = useState(finance.month)
  const [currency, setCurrency] = useState(current?.currency ?? 'EGP')
  const [amount, setAmount] = useState(current?.monthlyAmount ?? current?.hourlyRate ?? '')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  return (
    <Dialog
      title={tx(P.setTerms)}
      onClose={onClose}
      footer={
        <Footer
          onCancel={onClose}
          pending={save.isPending}
          onSave={() => {
            setTouched(true)
            if (!reason.trim() || !amount.trim()) return
            save.mutate(
              {
                effectiveMonth,
                salaryType,
                currency: currency.trim().toUpperCase(),
                ...(salaryType === 'shift' ? { monthlyAmount: amount.trim() } : { hourlyRate: amount.trim() }),
                reason: reason.trim(),
              },
              { onSuccess: onClose },
            )
          }}
        />
      }
    >
      <p className="field__hint">{tx(P.termsHint)}</p>
      <Select label={tx(P.salaryType)} value={salaryType} options={[['shift', P.shift], ['hourly', P.hourly]]} onChange={setSalaryType} />
      <Field label={tx(P.month)} type="month" value={effectiveMonth} onChange={setEffectiveMonth} />
      <Field label={tx(P.currency)} value={currency} onChange={setCurrency} />
      <Field
        label={tx(salaryType === 'shift' ? P.monthlySalary : P.hourlyRate)}
        type="number"
        value={amount}
        onChange={setAmount}
        error={touched && !amount.trim() ? tx(P.required) : null}
      />
      <Field label={tx(P.changeReason)} value={reason} onChange={setReason} error={touched && !reason.trim() ? tx(P.required) : null} />
      <PayrollError error={save.error} />
    </Dialog>
  )
}

const PAYOUT_FIELDS: Record<PayoutMethod, Array<keyof typeof P>> = {
  e_wallet: ['provider', 'walletNumber'],
  instapay: ['address'],
  bank_transfer: ['bankName', 'accountHolder', 'accountNumber', 'iban', 'swift'],
}
const OPTIONAL = new Set(['iban', 'swift'])

function PayoutDialog({ teacherId, onClose }: { teacherId: string; onClose: () => void }) {
  const tx = useCopy()
  const save = useSetPayoutAccount(teacherId)
  const [method, setMethod] = useState<PayoutMethod>('e_wallet')
  const [values, setValues] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const fields = PAYOUT_FIELDS[method]
  const missing = (k: string) => touched && !OPTIONAL.has(k) && !(values[k] ?? '').trim()
  return (
    <Dialog
      title={tx(P.setPayout)}
      onClose={onClose}
      footer={
        <Footer
          onCancel={onClose}
          pending={save.isPending}
          onSave={() => {
            setTouched(true)
            if (!reason.trim() || fields.some((k) => !OPTIONAL.has(k) && !(values[k] ?? '').trim())) return
            const details = Object.fromEntries(fields.filter((k) => (values[k] ?? '').trim()).map((k) => [k, (values[k] ?? '').trim()]))
            save.mutate({ method, details: details as unknown as PayoutDetails, reason: reason.trim() }, { onSuccess: onClose })
          }}
        />
      }
    >
      <p className="field__hint">{tx(P.payoutHint)}</p>
      <Select
        label={tx(P.method)}
        value={method}
        options={[['e_wallet', P.e_wallet], ['instapay', P.instapay], ['bank_transfer', P.bank_transfer]]}
        onChange={(m) => {
          setMethod(m)
          setValues({})
        }}
      />
      {fields.map((k) => (
        <Field
          key={`${method}-${k}`}
          label={tx(P[k])}
          type={k === 'provider' || k === 'bankName' || k === 'accountHolder' ? 'text' : 'tel'}
          value={values[k] ?? ''}
          onChange={(v) => setValues((x) => ({ ...x, [k]: v }))}
          error={missing(k) ? tx(P.required) : null}
        />
      ))}
      <Field label={tx(P.changeReason)} value={reason} onChange={setReason} error={touched && !reason.trim() ? tx(P.required) : null} />
      <PayrollError error={save.error} />
    </Dialog>
  )
}

/** The account details in clear exist only in this dialog's state; closing it drops them. */
function RevealDialog({ teacherId, onClose }: { teacherId: string; onClose: () => void }) {
  const tx = useCopy()
  const reveal = useRevealPayoutAccount(teacherId)
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const shown = reveal.data
  return (
    <Dialog
      title={tx(P.reveal)}
      onClose={onClose}
      footer={
        shown ? (
          <button type="button" className="btn btn--primary" onClick={onClose}>{tx(P.close)}</button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>{tx(P.close)}</button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={reveal.isPending}
              onClick={() => {
                setTouched(true)
                if (reason.trim()) reveal.mutate(reason.trim())
              }}
            >
              {tx(P.show)}
            </button>
          </>
        )
      }
    >
      {shown ? (
        <dl className="tf-kv" aria-label={tx(P.payout)}>
          <dt>{tx(P.method)}</dt>
          <dd>{tx(P[shown.method])}</dd>
          {Object.entries(shown.details).map(([k, v]) => (
            <FragmentRow key={k} label={k in P ? tx(P[k as keyof typeof P]) : k} value={v} />
          ))}
        </dl>
      ) : (
        <>
          <p className="field__hint">{tx(P.revealHint)}</p>
          <Field label={tx(P.revealReason)} value={reason} onChange={setReason} error={touched && !reason.trim() ? tx(P.required) : null} />
        </>
      )}
      <PayrollError error={reveal.error} />
    </Dialog>
  )
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd><bdi dir="ltr">{value}</bdi></dd>
    </>
  )
}

function AmountDialog({ teacherId, dialog, onClose }: { teacherId: string; dialog: Extract<NonNullable<Dialogs>, { kind: 'amount' }>; onClose: () => void }) {
  const tx = useCopy()
  const save = useAddAdjustment(teacherId)
  // An amount pricing a recorded bonus or deduction takes that record's month; a correction keeps its own.
  const needsMonth = !dialog.replaces && !dialog.bonusEntryId && !dialog.violationId
  const [amount, setAmount] = useState(dialog.replaces?.amount ?? '')
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  return (
    <Dialog
      title={dialog.title}
      onClose={onClose}
      footer={
        <Footer
          onCancel={onClose}
          pending={save.isPending}
          onSave={() => {
            setTouched(true)
            if (!reason.trim() || !amount.trim()) return
            save.mutate(
              dialog.replaces
                ? { replaces: dialog.replaces.id, amount: amount.trim(), reason: reason.trim() }
                : {
                    kind: dialog.adjustmentKind,
                    amount: amount.trim(),
                    reason: reason.trim(),
                    ...(dialog.bonusEntryId ? { bonusEntryId: dialog.bonusEntryId } : {}),
                    ...(dialog.violationId ? { violationId: dialog.violationId } : {}),
                    ...(needsMonth ? { month } : {}),
                  },
              { onSuccess: onClose },
            )
          }}
        />
      }
    >
      <p className="field__hint">{tx(P.amountHint)}</p>
      <Field label={tx(P.amount)} type="number" value={amount} onChange={setAmount} error={touched && !amount.trim() ? tx(P.required) : null} />
      {needsMonth && <Field label={tx(P.month)} type="month" value={month} onChange={setMonth} />}
      <Field label={tx(P.noteFor)} value={reason} onChange={setReason} error={touched && !reason.trim() ? tx(P.required) : null} />
      <PayrollError error={save.error} />
    </Dialog>
  )
}
