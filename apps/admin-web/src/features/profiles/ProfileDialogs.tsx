import { useId, useState, type ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { CURRENCIES } from '@/features/trials/copy'
import { formatMoney } from '@/features/instalments/copy'
import type { Payment, PaymentRequest, PlanMonths, RequestPurpose } from '@/features/payments/api'
import { METHOD, PAY, PURPOSE_LABEL, fromMinor, owed } from '@/features/payments/copy'
import { LinkPanel, ReasonDialog, ServerError as PaymentError } from '@/features/payments/PaymentParts'
import { S as SUB, monthsLabel } from '@/features/subscriptions/copy'
import type { FamilyBilling, InstalmentPaymentMethod, NewFamilyPayment, NewPaymentRequest, ParentProfile, ParentUpdate, PaymentMethod, TimelineInstalment } from './api'
import { COUNTRIES, EMIRATES, METHOD_LABEL, P, PLAN_MONTHS, countryName, describeError, planLabel, toMinor, useCopy } from './copy'
import {
  useCancelPaymentRequest,
  useCreateInstalments,
  useCreatePaymentRequest,
  useRecordFamilyPayment,
  useRecordPayment,
  useRefundPayment,
  useUpdateBilling,
  useUpdateParent,
  useVoidInstalment,
  useVoidPayment,
} from './hooks'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { newSubmitKey } from '@/core/submit-key'

function Footer({ onCancel, onSave, pending, saveLabel }: { onCancel: () => void; onSave: () => void; pending: boolean; saveLabel?: string }) {
  const tx = useCopy()
  return (
    <>
      <DialogCancelButton onClick={onCancel} />
      <button type="button" className="btn btn--primary" disabled={pending} onClick={onSave}>
        {pending ? tx(P.saving) : saveLabel ?? tx(P.save)}
      </button>
    </>
  )
}

function ServerError({ error }: { error: unknown }) {
  const { locale } = useI18n()
  if (!error) return null
  return (
    <div className="banner banner--danger" role="alert">
      {describeError(error, locale)}
    </div>
  )
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: (id: string, describedBy?: string) => ReactNode }) {
  const id = useId()
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children(id, describedBy)}
      {hint && (
        <span id={`${id}-hint`} className="field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-err`} className="field__error">
          {error}
        </span>
      )}
    </div>
  )
}

const blank = (v: string) => (v.trim() === '' ? null : v.trim())

/** Name, phone, e-mail, country, emirate / governorate. Only changed fields are sent; an emptied one is cleared. */
export function EditContactDialog({ profile, onClose }: { profile: ParentProfile; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const save = useUpdateParent(profile.id)
  const [name, setName] = useState(profile.name)
  const [phone, setPhone] = useState(profile.contact.phone ?? '')
  const [email, setEmail] = useState(profile.contact.email ?? '')
  const initialCountry = profile.contact.countryCode ?? ''
  const listed = initialCountry === '' || (COUNTRIES as readonly string[]).includes(initialCountry)
  const [country, setCountry] = useState(listed ? initialCountry : 'other')
  const [otherCountry, setOtherCountry] = useState(listed ? '' : initialCountry)
  const [region, setRegion] = useState(profile.contact.region ?? '')
  const [nameError, setNameError] = useState<string | null>(null)
  const regionList = useId()
  const code = country === 'other' ? otherCountry.trim().toUpperCase() : country

  const submit = () => {
    if (name.trim() === '') return setNameError(tx(P.required))
    const body: ParentUpdate = {}
    if (name.trim() !== profile.name) body.name = name.trim()
    if (blank(phone) !== profile.contact.phone) body.phone = blank(phone)
    if (blank(email) !== profile.contact.email) body.email = blank(email)
    if ((code || null) !== profile.contact.countryCode) body.countryCode = code || null
    if (blank(region) !== profile.contact.region) body.region = blank(region)
    if (Object.keys(body).length === 0) return onClose()
    save.mutate(body, { onSuccess: onClose })
  }

  return (
    <Dialog title={tx(P.editContact)} onClose={onClose} footer={<Footer onCancel={onClose} onSave={submit} pending={save.isPending} />}>
      <ServerError error={save.error} />
      <Field label={tx(P.fullName)} hint={tx(P.nameHint)} error={nameError}>
        {(id, d) => <input id={id} className="input" dir="auto" value={name} maxLength={120} aria-describedby={d} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label={tx(P.phone)} hint={tx(P.phoneHint)}>
        {(id, d) => <input id={id} className="input" type="tel" dir="ltr" value={phone} maxLength={32} aria-describedby={d} onChange={(e) => setPhone(e.target.value)} />}
      </Field>
      <Field label={tx(P.email)}>
        {(id) => <input id={id} className="input" type="email" dir="ltr" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <Field label={tx(P.country)}>
        {(id) => (
          <SearchableSelect id={id} className="select" value={country} onValueChange={(v) => setCountry(v)}>
            <option value="">{tx(P.noCountry)}</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {countryName(c, locale)}
              </option>
            ))}
            <option value="other">{tx(P.otherCountry)}</option>
          </SearchableSelect>
        )}
      </Field>
      {country === 'other' && (
        <Field label={tx(P.countryCode)}>
          {(id) => <input id={id} className="input" dir="ltr" value={otherCountry} maxLength={2} onChange={(e) => setOtherCountry(e.target.value)} />}
        </Field>
      )}
      <Field label={tx(P.region)}>
        {(id) => (
          <>
            <input id={id} className="input" dir="auto" value={region} maxLength={80} list={code === 'AE' ? regionList : undefined} onChange={(e) => setRegion(e.target.value)} />
            {code === 'AE' && (
              <datalist id={regionList}>
                {EMIRATES.map((e) => (
                  <option key={e.en} value={tx(e)} />
                ))}
              </datalist>
            )}
          </>
        )}
      </Field>
    </Dialog>
  )
}

/** The administration's internal note about the parent. */
export function EditNoteDialog({ profile, onClose }: { profile: ParentProfile; onClose: () => void }) {
  const tx = useCopy()
  const save = useUpdateParent(profile.id)
  const [note, setNote] = useState(profile.adminNote ?? '')
  const submit = () => {
    if (blank(note) === profile.adminNote) return onClose()
    save.mutate({ adminNote: blank(note) }, { onSuccess: onClose })
  }
  return (
    <Dialog title={tx(P.editNote)} onClose={onClose} footer={<Footer onCancel={onClose} onSave={submit} pending={save.isPending} />}>
      <ServerError error={save.error} />
      <Field label={tx(P.about)} hint={tx(P.aboutHint)}>
        {(id, d) => (
          <textarea id={id} className="input tf-textarea" dir="auto" rows={5} maxLength={1000} value={note} aria-describedby={d} onChange={(e) => setNote(e.target.value)} />
        )}
      </Field>
    </Dialog>
  )
}

/** The family's plan, payment method and currency. */
export function EditBillingDialog({ billing, onClose }: { billing: FamilyBilling; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const save = useUpdateBilling(billing.familyId)
  const [plan, setPlan] = useState(billing.planMonths === null ? '' : String(billing.planMonths))
  const [method, setMethod] = useState<string>(billing.paymentMethod ?? '')
  const [currency, setCurrency] = useState(billing.currency ?? '')
  const submit = () => {
    const body: Parameters<typeof save.mutate>[0] = {}
    const planMonths = plan === '' ? null : Number(plan)
    if (planMonths !== billing.planMonths) body.planMonths = planMonths
    if ((method || null) !== billing.paymentMethod) body.paymentMethod = (method || null) as PaymentMethod | null
    if ((currency || null) !== billing.currency) body.currency = currency || null
    if (Object.keys(body).length === 0) return onClose()
    save.mutate(body, { onSuccess: onClose })
  }
  return (
    <Dialog title={tx(P.editPayments)} onClose={onClose} footer={<Footer onCancel={onClose} onSave={submit} pending={save.isPending} />}>
      <ServerError error={save.error} />
      <Field label={tx(P.plan)}>
        {(id) => (
          <SearchableSelect id={id} className="select" value={plan} onValueChange={(v) => setPlan(v)}>
            <option value="">{tx(P.none)}</option>
            {PLAN_MONTHS.map((n) => (
              <option key={n} value={n}>
                {planLabel(n, locale)}
              </option>
            ))}
          </SearchableSelect>
        )}
      </Field>
      <Field label={tx(P.method)}>
        {(id) => (
          <SearchableSelect id={id} className="select" value={method} onValueChange={(v) => setMethod(v)}>
            <option value="">{tx(P.none)}</option>
            {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {tx(METHOD_LABEL[m])}
              </option>
            ))}
          </SearchableSelect>
        )}
      </Field>
      <Field label={tx(P.currency)}>
        {(id) => (
          <SearchableSelect id={id} className="select" value={currency} onValueChange={(v) => setCurrency(v)}>
            <option value="">{tx(P.none)}</option>
            {[...new Set([...(billing.currency ? [billing.currency] : []), ...CURRENCIES])].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SearchableSelect>
        )}
      </Field>
    </Dialog>
  )
}

/**
 * One instalment, a plan of several a fixed number of months apart, or (PD-27)
 * a custom schedule of 1-24 rows, each with its own amount and due date.
 */
export function NewInstalmentsDialog({
  billing,
  children,
  onClose,
}: {
  billing: FamilyBilling
  children: Array<{ id: string; name: string }>
  onClose: () => void
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const create = useCreateInstalments(billing.familyId)
  const [mode, setMode] = useState<'equal' | 'custom'>('equal')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(billing.currency ?? 'AED')
  const [firstDueDate, setFirstDueDate] = useState(billing.today)
  const [count, setCount] = useState('1')
  const [every, setEvery] = useState('1')
  const [rows, setRows] = useState<Array<{ amount: string; dueDate: string }>>([{ amount: '', dueDate: billing.today }])
  const [learnerId, setLearnerId] = useState('')
  // PD-30: a plan for one child's subscription may carry its lessons.
  const [lessons, setLessons] = useState('')
  const [lessonPlan, setLessonPlan] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const modeName = useId()
  const lessonsMinor = lessons.trim() === '' ? null : Number(lessons)
  const lessonsValid = lessonsMinor === null || (Number.isInteger(lessonsMinor) && lessonsMinor >= 1 && lessonsMinor <= 1000)
  const withLessons = learnerId && lessonsMinor !== null && lessonsValid
    ? { lessonsIncluded: lessonsMinor, ...(lessonPlan ? { planMonths: Number(lessonPlan) } : {}) }
    : {}

  const setRow = (i: number, patch: Partial<{ amount: string; dueDate: string }>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const rowMinor = rows.map((r) => toMinor(r.amount, currency))
  const total = rowMinor.reduce<number>((sum, n) => sum + (n ?? 0), 0)

  const submit = () => {
    const next: Record<string, string> = {}
    if (label.trim() === '') next.label = tx(P.required)
    if (!lessonsValid) next.lessons = tx(SUB.invalidLessons)
    if (mode === 'equal') {
      const amountMinor = toMinor(amount, currency)
      if (amountMinor === null) next.amount = tx(P.invalidAmount)
      if (!firstDueDate) next.firstDueDate = tx(P.required)
      setErrors(next)
      if (Object.keys(next).length > 0 || amountMinor === null) return
      create.mutate(
        {
          label: label.trim(),
          amountMinor,
          currency,
          firstDueDate,
          count: Number(count),
          everyMonths: Number(every),
          learnerId: learnerId || null,
          ...withLessons,
        },
        { onSuccess: onClose },
      )
      return
    }
    rows.forEach((r, i) => {
      if (rowMinor[i] === null) next[`amount${i}`] = tx(P.invalidAmount)
      if (!r.dueDate) next[`due${i}`] = tx(P.required)
    })
    setErrors(next)
    if (Object.keys(next).length > 0) return
    create.mutate(
      {
        label: label.trim(),
        currency,
        learnerId: learnerId || null,
        items: rows.map((r, i) => ({ amountMinor: rowMinor[i]!, dueDate: r.dueDate })),
        ...withLessons,
      },
      { onSuccess: onClose },
    )
  }

  const currencyField = (
    <Field label={tx(P.currency)}>
      {(id) => (
        <SearchableSelect id={id} className="select" value={currency} onValueChange={(v) => setCurrency(v)}>
          {[...new Set([...(billing.currency ? [billing.currency] : []), ...CURRENCIES])].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </SearchableSelect>
      )}
    </Field>
  )

  return (
    <Dialog title={tx(P.newTitle)} onClose={onClose} footer={<Footer onCancel={onClose} onSave={submit} pending={create.isPending} saveLabel={tx(P.create)} />}>
      <ServerError error={create.error} />
      <fieldset className="pay-mode">
        <legend className="sr-only">{tx(P.scheduleMode)}</legend>
        <label>
          <input type="radio" name={modeName} checked={mode === 'equal'} onChange={() => setMode('equal')} />
          {tx(P.equalMode)}
        </label>
        <label>
          <input type="radio" name={modeName} checked={mode === 'custom'} onChange={() => setMode('custom')} />
          {tx(P.customMode)}
        </label>
      </fieldset>
      <Field label={tx(P.label)} hint={tx(P.labelHint)} error={errors.label}>
        {(id, d) => <input id={id} className="input" dir="auto" value={label} maxLength={100} aria-describedby={d} onChange={(e) => setLabel(e.target.value)} />}
      </Field>
      {mode === 'equal' ? (
        <>
          <div className="pf-row">
            <Field label={tx(P.amount)} error={errors.amount}>
              {(id, d) => <input id={id} className="input" inputMode="decimal" dir="ltr" value={amount} aria-describedby={d} onChange={(e) => setAmount(e.target.value)} />}
            </Field>
            {currencyField}
          </div>
          <div className="pf-row">
            <Field label={tx(P.firstDue)} error={errors.firstDueDate}>
              {(id) => <input id={id} className="input" type="date" dir="ltr" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} />}
            </Field>
            <Field label={tx(P.count)}>
              {(id) => (
                <SearchableSelect id={id} className="select" value={count} onValueChange={(v) => setCount(v)}>
                  {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </SearchableSelect>
              )}
            </Field>
            {count !== '1' && (
              <Field label={tx(P.every)}>
                {(id) => (
                  <SearchableSelect id={id} className="select" value={every} onValueChange={(v) => setEvery(v)}>
                    {[1, 2, 3, 6, 12].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </SearchableSelect>
                )}
              </Field>
            )}
          </div>
        </>
      ) : (
        <>
          {currencyField}
          <ol className="pay-schedule">
            {rows.map((r, i) => (
              <li key={i} className="pay-schedule__row">
                <Field label={tx(P.rowAmount, { n: i + 1 })} error={errors[`amount${i}`]}>
                  {(id, d) => (
                    <input id={id} className="input" inputMode="decimal" dir="ltr" value={r.amount} aria-describedby={d} onChange={(e) => setRow(i, { amount: e.target.value })} />
                  )}
                </Field>
                <Field label={tx(P.rowDue, { n: i + 1 })} error={errors[`due${i}`]}>
                  {(id) => <input id={id} className="input" type="date" dir="ltr" value={r.dueDate} onChange={(e) => setRow(i, { dueDate: e.target.value })} />}
                </Field>
                {rows.length > 1 && (
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    aria-label={tx(P.removeRow, { n: i + 1 })}
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ol>
          <div className="tf-actions">
            <button
              type="button"
              className="btn btn--sm"
              disabled={rows.length >= 24}
              onClick={() => setRows((rs) => [...rs, { amount: '', dueDate: rs[rs.length - 1]?.dueDate ?? billing.today }])}
            >
              {tx(P.addRow)}
            </button>
            <span className="field__hint" role="status">
              {tx(P.scheduleTotal, { amount: formatMoney(total, currency, locale) })}
              {rows.length >= 24 && ` · ${tx(P.scheduleMax)}`}
            </span>
          </div>
        </>
      )}
      {children.length > 0 && (
        <Field label={tx(P.child)}>
          {(id) => (
            <SearchableSelect id={id} className="select" value={learnerId} onValueChange={(v) => setLearnerId(v)}>
              <option value="">{tx(P.wholeFamily)}</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SearchableSelect>
          )}
        </Field>
      )}
      {learnerId && (
        <div className="pf-row">
          <Field label={tx(SUB.lessons)} hint={tx(SUB.lessonsHint)} error={errors.lessons}>
            {(id, d) => (
              <input id={id} className="input" type="number" inputMode="numeric" dir="ltr" min={1} max={1000} value={lessons} aria-describedby={d} onChange={(e) => setLessons(e.target.value)} />
            )}
          </Field>
          <Field label={tx(SUB.plan)}>
            {(id) => (
              <SearchableSelect id={id} className="select" value={lessonPlan} onValueChange={(v) => setLessonPlan(v)}>
                <option value="">{tx(SUB.noPlan)}</option>
                {PLAN_MONTHS.map((n) => (
                  <option key={n} value={n}>
                    {monthsLabel(n, locale)}
                  </option>
                ))}
              </SearchableSelect>
            )}
          </Field>
        </div>
      )}
    </Dialog>
  )
}

const INSTALMENT_METHODS: readonly InstalmentPaymentMethod[] = ['invoice', 'bank_transfer', 'cash']

/** A payment for the whole remaining amount: the day it arrived, how, and an optional reference. */
export function RecordPaymentDialog({ billing, instalment, onClose }: { billing: FamilyBilling; instalment: TimelineInstalment; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const pay = useRecordPayment(billing.familyId)
  const [paidOn, setPaidOn] = useState(billing.today)
  const [method, setMethod] = useState<InstalmentPaymentMethod>(billing.paymentMethod ?? 'bank_transfer')
  const [reference, setReference] = useState('')
  // ADMIN-001: one key for this form, resent on every retry of it.
  const [paymentId] = useState(newSubmitKey)
  const submit = () => pay.mutate({ id: instalment.id, paidOn, method, reference: reference.trim() || undefined, paymentId }, { onSuccess: onClose })
  return (
    <Dialog
      title={tx(P.payTitle, { label: instalment.label })}
      onClose={onClose}
      footer={<Footer onCancel={onClose} onSave={submit} pending={pay.isPending} saveLabel={tx(P.recordPayment)} />}
    >
      <ServerError error={pay.error} />
      <p className="field__hint">{tx(P.payOnce)}</p>
      {instalment.partial && (
        <p className="field__hint">{tx(P.wholeRemaining, { amount: formatMoney(instalment.remainingMinor, instalment.currency, locale) })}</p>
      )}
      <Field label={tx(P.paidOn)}>
        {(id) => <input id={id} className="input" type="date" dir="ltr" max={billing.today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}
      </Field>
      <Field label={tx(P.method)}>
        {(id) => (
          <SearchableSelect id={id} className="select" value={method} onValueChange={(v) => setMethod(v as InstalmentPaymentMethod)}>
            {INSTALMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {tx(METHOD[m])}
              </option>
            ))}
          </SearchableSelect>
        )}
      </Field>
      <Field label={tx(P.reference)} hint={tx(P.referenceHint)}>
        {(id, d) => <input id={id} className="input" dir="ltr" value={reference} maxLength={120} aria-describedby={d} onChange={(e) => setReference(e.target.value)} />}
      </Field>
    </Dialog>
  )
}

/** Final, with a reason. The row stays in the timeline, marked voided. */
export function VoidInstalmentDialog({ billing, instalment, onClose }: { billing: FamilyBilling; instalment: TimelineInstalment; onClose: () => void }) {
  const tx = useCopy()
  const voiding = useVoidInstalment(billing.familyId)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    if (reason.trim() === '') return setError(tx(P.reasonRequired))
    voiding.mutate({ id: instalment.id, reason: reason.trim() }, { onSuccess: onClose })
  }
  return (
    <Dialog
      title={tx(P.voidTitle, { label: instalment.label })}
      onClose={onClose}
      footer={<Footer onCancel={onClose} onSave={submit} pending={voiding.isPending} saveLabel={tx(P.void)} />}
    >
      <ServerError error={voiding.error} />
      <p className="field__hint">{tx(P.voidHint)}</p>
      <Field label={tx(P.reason)} error={error}>
        {(id, d) => <textarea id={id} className="input tf-textarea" dir="auto" rows={3} maxLength={500} value={reason} aria-describedby={d} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ PD-27 */

const PURPOSES: readonly RequestPurpose[] = ['subscription', 'renewal', 'instalment', 'balance', 'other']
/** A package is what a subscription or a renewal buys. */
const takesPackage = (p: RequestPurpose) => p === 'subscription' || p === 'renewal'

function currencyChoices(current: string | null): string[] {
  return [...new Set([...(current ? [current] : []), ...CURRENCIES])]
}

/** "Link valid for (days)": 1-90, the server's default 14. Null when out of range. */
function expiryDays(input: string): number | null {
  const n = Number(input)
  return Number.isInteger(n) && n >= 1 && n <= 90 ? n : null
}

/**
 * PD-27: a payment request with its own link. Once created the dialog shows
 * the link with Copy and "Send on WhatsApp"; the server sends nothing.
 */
export function RequestPaymentDialog({
  billing,
  children,
  onClose,
}: {
  billing: FamilyBilling
  children: Array<{ id: string; name: string }>
  onClose: () => void
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const create = useCreatePaymentRequest(billing.familyId)
  const [created, setCreated] = useState<PaymentRequest | null>(null)
  const [purpose, setPurpose] = useState<RequestPurpose>('subscription')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(billing.currency ?? 'AED')
  const [learnerId, setLearnerId] = useState('')
  const [plan, setPlan] = useState(billing.planMonths && (PLAN_MONTHS as readonly number[]).includes(billing.planMonths) ? String(billing.planMonths) : '')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [days, setDays] = useState('14')
  const [lessons, setLessons] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  if (created) {
    return (
      <Dialog
        title={tx(PAY.requestTitle)}
        onClose={onClose}
        footer={
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {tx(PAY.done)}
          </button>
        }
      >
        <LinkPanel request={created} />
      </Dialog>
    )
  }

  const submit = () => {
    const amountMinor = toMinor(amount, currency)
    const expiresInDays = expiryDays(days)
    const next: Record<string, string> = {}
    if (label.trim() === '') next.label = tx(PAY.required)
    if (amountMinor === null) next.amount = tx(PAY.invalidAmount)
    if (expiresInDays === null) next.days = tx(PAY.invalidDays)
    if (periodStart && periodEnd && periodEnd < periodStart) next.period = tx(PAY.periodOrder)
    const lessonCount = lessons.trim() === '' ? null : Number(lessons)
    if (lessonCount !== null && !(Number.isInteger(lessonCount) && lessonCount >= 1 && lessonCount <= 1000)) next.lessons = tx(SUB.invalidLessons)
    setErrors(next)
    if (Object.keys(next).length > 0 || amountMinor === null || expiresInDays === null) return
    const pkg = takesPackage(purpose)
    const body: NewPaymentRequest = { purpose, label: label.trim(), amountMinor, currency, expiresInDays }
    if (learnerId) body.learnerId = learnerId
    if (pkg && plan) body.planMonths = Number(plan) as PlanMonths
    if (pkg && lessonCount !== null) body.lessonsIncluded = lessonCount
    if (pkg && periodStart) body.periodStart = periodStart
    if (pkg && periodEnd) body.periodEnd = periodEnd
    create.mutate(body, { onSuccess: ({ request }) => setCreated(request) })
  }

  return (
    <Dialog
      title={tx(PAY.requestTitle)}
      onClose={onClose}
      footer={<Footer onCancel={onClose} onSave={submit} pending={create.isPending} saveLabel={tx(PAY.createLink)} />}
    >
      <PaymentError error={create.error} />
      <p className="field__hint">{tx(PAY.requestHint)}</p>
      <Field label={tx(PAY.purpose)}>
        {(id) => (
          <SearchableSelect id={id} className="select" value={purpose} onValueChange={(v) => setPurpose(v as RequestPurpose)}>
            {PURPOSES.map((p) => (
              <option key={p} value={p}>
                {tx(PURPOSE_LABEL[p])}
              </option>
            ))}
          </SearchableSelect>
        )}
      </Field>
      <Field label={tx(PAY.label)} hint={tx(PAY.labelHint)} error={errors.label}>
        {(id, d) => <input id={id} className="input" dir="auto" value={label} maxLength={100} aria-describedby={d} onChange={(e) => setLabel(e.target.value)} />}
      </Field>
      <div className="pf-row">
        <Field label={tx(PAY.amount)} error={errors.amount}>
          {(id, d) => <input id={id} className="input" inputMode="decimal" dir="ltr" value={amount} aria-describedby={d} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label={tx(PAY.currency)}>
          {(id) => (
            <SearchableSelect id={id} className="select" value={currency} onValueChange={(v) => setCurrency(v)}>
              {currencyChoices(billing.currency).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SearchableSelect>
          )}
        </Field>
      </div>
      {children.length > 0 && (
        <Field label={tx(PAY.child)}>
          {(id) => (
            <SearchableSelect id={id} className="select" value={learnerId} onValueChange={(v) => setLearnerId(v)}>
              <option value="">{tx(PAY.wholeFamily)}</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SearchableSelect>
          )}
        </Field>
      )}
      {takesPackage(purpose) && (
        <>
          <Field label={tx(PAY.plan)}>
            {(id) => (
              <SearchableSelect id={id} className="select" value={plan} onValueChange={(v) => setPlan(v)}>
                <option value="">{tx(PAY.noPlan)}</option>
                {PLAN_MONTHS.map((n) => (
                  <option key={n} value={n}>
                    {planLabel(n, locale)}
                  </option>
                ))}
              </SearchableSelect>
            )}
          </Field>
          <Field label={tx(SUB.lessons)} hint={tx(SUB.lessonsHint)} error={errors.lessons}>
            {(id, d) => (
              <input id={id} className="input" type="number" inputMode="numeric" dir="ltr" min={1} max={1000} value={lessons} aria-describedby={d} onChange={(e) => setLessons(e.target.value)} />
            )}
          </Field>
          <div className="pf-row">
            <Field label={tx(PAY.periodStart)} error={errors.period}>
              {(id) => <input id={id} className="input" type="date" dir="ltr" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />}
            </Field>
            <Field label={tx(PAY.periodEnd)}>
              {(id) => <input id={id} className="input" type="date" dir="ltr" min={periodStart || undefined} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />}
            </Field>
          </div>
        </>
      )}
      <Field label={tx(PAY.expiresIn)} hint={tx(PAY.expiresInHint)} error={errors.days}>
        {(id, d) => (
          <input id={id} className="input" type="number" inputMode="numeric" dir="ltr" min={1} max={90} value={days} aria-describedby={d} onChange={(e) => setDays(e.target.value)} />
        )}
      </Field>
    </Dialog>
  )
}

/**
 * PD-27: an open instalment's own link. When it already has an open request
 * its link is shown (no second request); otherwise one is created for what the
 * instalment still owes (the server fills in the amount and the purpose).
 */
export function InstalmentLinkDialog({ billing, instalment, onClose }: { billing: FamilyBilling; instalment: TimelineInstalment; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const create = useCreatePaymentRequest(billing.familyId)
  const existing = instalment.requestId ? billing.requests.find((r) => r.id === instalment.requestId && r.status === 'open') : undefined
  const [created, setCreated] = useState<PaymentRequest | null>(null)
  const [days, setDays] = useState('14')
  const [error, setError] = useState<string | null>(null)
  const shown = created ?? existing ?? null
  const title = tx(PAY.instalmentLinkTitle, { label: instalment.label })
  const remaining = instalment.partial ? instalment.remainingMinor : instalment.amountMinor

  if (shown) {
    return (
      <Dialog
        title={title}
        onClose={onClose}
        footer={
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {tx(PAY.done)}
          </button>
        }
      >
        <LinkPanel request={shown} />
      </Dialog>
    )
  }

  const submit = () => {
    const expiresInDays = expiryDays(days)
    if (expiresInDays === null) return setError(tx(PAY.invalidDays))
    setError(null)
    create.mutate(
      { purpose: 'instalment', label: instalment.label, instalmentId: instalment.id, expiresInDays },
      { onSuccess: ({ request }) => setCreated(request) },
    )
  }
  return (
    <Dialog title={title} onClose={onClose} footer={<Footer onCancel={onClose} onSave={submit} pending={create.isPending} saveLabel={tx(PAY.createLink)} />}>
      <PaymentError error={create.error} />
      <p className="field__hint">{tx(PAY.instalmentLinkHint, { amount: formatMoney(remaining, instalment.currency, locale) })}</p>
      <Field label={tx(PAY.expiresIn)} hint={tx(PAY.expiresInHint)} error={error}>
        {(id, d) => (
          <input id={id} className="input" type="number" inputMode="numeric" dir="ltr" min={1} max={90} value={days} aria-describedby={d} onChange={(e) => setDays(e.target.value)} />
        )}
      </Field>
    </Dialog>
  )
}

export function CancelRequestDialog({ billing, request, onClose }: { billing: FamilyBilling; request: PaymentRequest; onClose: () => void }) {
  const tx = useCopy()
  const cancel = useCancelPaymentRequest(billing.familyId)
  return (
    <ReasonDialog
      title={tx(PAY.cancelRequestNamed, { label: request.label })}
      hint={tx(PAY.cancelHint)}
      confirmLabel={tx(PAY.cancelConfirm)}
      pending={cancel.isPending}
      error={cancel.error}
      onSubmit={(reason) => cancel.mutate({ id: request.id, reason }, { onSuccess: onClose })}
      onClose={onClose}
    />
  )
}

/**
 * PD-27: money already received -- cash or a bank transfer, by any payment
 * recorder (PD-17 / PD-20). Optionally towards an open request or
 * instalment, whose remaining amount it prefills.
 */
export function RecordFamilyPaymentDialog({
  billing,
  children,
  onClose,
}: {
  billing: FamilyBilling
  children: Array<{ id: string; name: string }>
  onClose: () => void
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const record = useRecordFamilyPayment(billing.familyId)
  // ADMIN-001: one key for this form, resent on every retry of it.
  const [paymentId] = useState(newSubmitKey)
  const [method, setMethod] = useState<NewFamilyPayment['method']>('cash')
  const [towards, setTowards] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(billing.currency ?? 'AED')
  const [paidOn, setPaidOn] = useState(billing.today)
  const [learnerId, setLearnerId] = useState('')
  const [reference, setReference] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const openRequests = billing.requests.filter((r) => r.status === 'open')
  const openInstalments = billing.instalments.filter((i) => i.status !== 'paid' && i.status !== 'voided')
  const instalmentOwes = (i: TimelineInstalment) => (i.partial ? i.remainingMinor : i.amountMinor)

  const choose = (value: string) => {
    setTowards(value)
    const [kind, id] = [value.slice(0, 2), value.slice(2)]
    const target =
      kind === 'r:'
        ? openRequests.find((r) => r.id === id)
        : kind === 'i:'
          ? openInstalments.find((i) => i.id === id)
          : undefined
    if (!target) return
    const due = 'purpose' in target ? owed(target) : instalmentOwes(target)
    setCurrency(target.currency)
    setAmount(fromMinor(due, target.currency))
    if (target.child?.id) setLearnerId(target.child.id)
  }

  const submit = () => {
    const amountMinor = toMinor(amount, currency)
    const next: Record<string, string> = {}
    if (amountMinor === null) next.amount = tx(PAY.invalidAmount)
    if (!paidOn) next.paidOn = tx(PAY.required)
    setErrors(next)
    if (Object.keys(next).length > 0 || amountMinor === null) return
    const body: NewFamilyPayment = { method, amountMinor, paidOn, paymentId }
    if (towards.startsWith('r:')) body.requestId = towards.slice(2)
    if (towards.startsWith('i:')) body.instalmentId = towards.slice(2)
    if (learnerId) body.learnerId = learnerId
    if (reference.trim()) body.reference = reference.trim()
    record.mutate(body, { onSuccess: onClose })
  }

  return (
    <Dialog
      title={tx(PAY.recordTitle)}
      onClose={onClose}
      footer={<Footer onCancel={onClose} onSave={submit} pending={record.isPending} saveLabel={tx(PAY.record)} />}
    >
      <PaymentError error={record.error} />
      <p className="field__hint">{tx(PAY.recordHint)}</p>
      <Field label={tx(PAY.method)}>
        {(id) => (
          <SearchableSelect id={id} className="select" value={method} onValueChange={(v) => setMethod(v as NewFamilyPayment['method'])}>
            <option value="cash">{tx(METHOD.cash)}</option>
            <option value="bank_transfer">{tx(METHOD.bank_transfer)}</option>
          </SearchableSelect>
        )}
      </Field>
      {(openRequests.length > 0 || openInstalments.length > 0) && (
        <Field label={tx(PAY.towards)}>
          {(id) => (
            <SearchableSelect id={id} className="select" value={towards} onValueChange={(v) => choose(v)}>
              <option value="">{tx(PAY.towardsNothing)}</option>
              {openRequests.map((r) => (
                <option key={r.id} value={`r:${r.id}`}>
                  {tx(PAY.towardsRequest, { label: r.label, remaining: formatMoney(owed(r), r.currency, locale) })}
                </option>
              ))}
              {openInstalments.map((i) => (
                <option key={i.id} value={`i:${i.id}`}>
                  {tx(PAY.towardsInstalment, { label: i.label, remaining: formatMoney(instalmentOwes(i), i.currency, locale) })}
                </option>
              ))}
            </SearchableSelect>
          )}
        </Field>
      )}
      <div className="pf-row">
        <Field label={tx(PAY.amount)} error={errors.amount}>
          {(id, d) => <input id={id} className="input" inputMode="decimal" dir="ltr" value={amount} aria-describedby={d} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        {towards === '' && (
          <Field label={tx(PAY.currency)}>
            {(id) => (
              <SearchableSelect id={id} className="select" value={currency} onValueChange={(v) => setCurrency(v)}>
                {currencyChoices(billing.currency).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </SearchableSelect>
            )}
          </Field>
        )}
      </div>
      <Field label={tx(PAY.paidOn)} error={errors.paidOn}>
        {(id) => <input id={id} className="input" type="date" dir="ltr" max={billing.today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}
      </Field>
      {children.length > 0 && (
        <Field label={tx(PAY.child)}>
          {(id) => (
            <SearchableSelect id={id} className="select" value={learnerId} onValueChange={(v) => setLearnerId(v)}>
              <option value="">{tx(PAY.wholeFamily)}</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SearchableSelect>
          )}
        </Field>
      )}
      <Field label={tx(PAY.reference)} hint={tx(PAY.referenceHint)}>
        {(id, d) => <input id={id} className="input" dir="ltr" value={reference} maxLength={120} aria-describedby={d} onChange={(e) => setReference(e.target.value)} />}
      </Field>
    </Dialog>
  )
}

export function VoidPaymentDialog({ billing, payment, onClose }: { billing: FamilyBilling; payment: Payment; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const voiding = useVoidPayment(billing.familyId)
  return (
    <ReasonDialog
      title={tx(PAY.voidTitle, { amount: formatMoney(payment.amountMinor, payment.currency, locale) })}
      hint={tx(PAY.voidHint)}
      confirmLabel={tx(PAY.voidPayment)}
      pending={voiding.isPending}
      error={voiding.error}
      onSubmit={(reason) => voiding.mutate({ id: payment.id, reason }, { onSuccess: onClose })}
      onClose={onClose}
    />
  )
}

/** At most what is still refundable on the payment; a card payment is refunded through Stripe. */
export function RefundPaymentDialog({ billing, payment, onClose }: { billing: FamilyBilling; payment: Payment; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const refund = useRefundPayment(billing.familyId)
  const refundable = payment.amountMinor - payment.refundedMinor
  const [amount, setAmount] = useState(fromMinor(refundable, payment.currency))
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  // ADMIN-001: one key for this form, resent on every retry of it.
  const [refundId] = useState(newSubmitKey)
  const submit = () => {
    const amountMinor = toMinor(amount, payment.currency)
    const next: Record<string, string> = {}
    if (amountMinor === null) next.amount = tx(PAY.invalidAmount)
    else if (amountMinor > refundable) next.amount = tx(PAY.refundTooMuch)
    if (reason.trim() === '') next.reason = tx(PAY.reasonRequired)
    setErrors(next)
    if (Object.keys(next).length > 0 || amountMinor === null) return
    refund.mutate({ id: payment.id, amountMinor, reason: reason.trim(), refundId }, { onSuccess: onClose })
  }
  return (
    <Dialog
      title={tx(PAY.refundTitle, { amount: formatMoney(payment.amountMinor, payment.currency, locale) })}
      onClose={onClose}
      footer={<Footer onCancel={onClose} onSave={submit} pending={refund.isPending} saveLabel={tx(PAY.refund)} />}
    >
      <PaymentError error={refund.error} />
      <p className="field__hint">{tx(PAY.refundHint, { amount: formatMoney(refundable, payment.currency, locale) })}</p>
      <Field label={tx(PAY.refundAmount)} error={errors.amount}>
        {(id, d) => <input id={id} className="input" inputMode="decimal" dir="ltr" value={amount} aria-describedby={d} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <Field label={tx(PAY.reason)} error={errors.reason}>
        {(id, d) => <textarea id={id} className="input tf-textarea" dir="auto" rows={3} maxLength={500} value={reason} aria-describedby={d} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Dialog>
  )
}
