import { useId, useState, type ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { CURRENCIES } from '@/features/trials/copy'
import type { FamilyBilling, ParentProfile, ParentUpdate, PaymentMethod, TimelineInstalment } from './api'
import { COUNTRIES, EMIRATES, METHOD_LABEL, P, PLAN_MONTHS, countryName, describeError, planLabel, toMinor, useCopy } from './copy'
import { useCreateInstalments, useRecordPayment, useUpdateBilling, useUpdateParent, useVoidInstalment } from './hooks'

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
          <select id={id} className="select" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">{tx(P.noCountry)}</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {countryName(c, locale)}
              </option>
            ))}
            <option value="other">{tx(P.otherCountry)}</option>
          </select>
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
          <select id={id} className="select" value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="">{tx(P.none)}</option>
            {PLAN_MONTHS.map((n) => (
              <option key={n} value={n}>
                {planLabel(n, locale)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={tx(P.method)}>
        {(id) => (
          <select id={id} className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">{tx(P.none)}</option>
            {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {tx(METHOD_LABEL[m])}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={tx(P.currency)}>
        {(id) => (
          <select id={id} className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="">{tx(P.none)}</option>
            {[...new Set([...(billing.currency ? [billing.currency] : []), ...CURRENCIES])].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </Field>
    </Dialog>
  )
}

/** One instalment, or a plan of several a fixed number of months apart. */
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
  const create = useCreateInstalments(billing.familyId)
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(billing.currency ?? 'AED')
  const [firstDueDate, setFirstDueDate] = useState(billing.today)
  const [count, setCount] = useState('1')
  const [every, setEvery] = useState('1')
  const [learnerId, setLearnerId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const amountMinor = toMinor(amount, currency)
    const next: Record<string, string> = {}
    if (label.trim() === '') next.label = tx(P.required)
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
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Dialog title={tx(P.newTitle)} onClose={onClose} footer={<Footer onCancel={onClose} onSave={submit} pending={create.isPending} saveLabel={tx(P.create)} />}>
      <ServerError error={create.error} />
      <Field label={tx(P.label)} hint={tx(P.labelHint)} error={errors.label}>
        {(id, d) => <input id={id} className="input" dir="auto" value={label} maxLength={100} aria-describedby={d} onChange={(e) => setLabel(e.target.value)} />}
      </Field>
      <div className="pf-row">
        <Field label={tx(P.amount)} error={errors.amount}>
          {(id, d) => <input id={id} className="input" inputMode="decimal" dir="ltr" value={amount} aria-describedby={d} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label={tx(P.currency)}>
          {(id) => (
            <select id={id} className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {[...new Set([...(billing.currency ? [billing.currency] : []), ...CURRENCIES])].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="pf-row">
        <Field label={tx(P.firstDue)} error={errors.firstDueDate}>
          {(id) => <input id={id} className="input" type="date" dir="ltr" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} />}
        </Field>
        <Field label={tx(P.count)}>
          {(id) => (
            <select id={id} className="select" value={count} onChange={(e) => setCount(e.target.value)}>
              {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
        </Field>
        {count !== '1' && (
          <Field label={tx(P.every)}>
            {(id) => (
              <select id={id} className="select" value={every} onChange={(e) => setEvery(e.target.value)}>
                {[1, 2, 3, 6, 12].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
      </div>
      {children.length > 0 && (
        <Field label={tx(P.child)}>
          {(id) => (
            <select id={id} className="select" value={learnerId} onChange={(e) => setLearnerId(e.target.value)}>
              <option value="">{tx(P.wholeFamily)}</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
    </Dialog>
  )
}

/** A payment, once: the day it arrived, how, and an optional reference. */
export function RecordPaymentDialog({ billing, instalment, onClose }: { billing: FamilyBilling; instalment: TimelineInstalment; onClose: () => void }) {
  const tx = useCopy()
  const pay = useRecordPayment(billing.familyId)
  const [paidOn, setPaidOn] = useState(billing.today)
  const [method, setMethod] = useState<PaymentMethod>(billing.paymentMethod ?? 'bank_transfer')
  const [reference, setReference] = useState('')
  const submit = () => pay.mutate({ id: instalment.id, paidOn, method, reference: reference.trim() || undefined }, { onSuccess: onClose })
  return (
    <Dialog
      title={tx(P.payTitle, { label: instalment.label })}
      onClose={onClose}
      footer={<Footer onCancel={onClose} onSave={submit} pending={pay.isPending} saveLabel={tx(P.recordPayment)} />}
    >
      <ServerError error={pay.error} />
      <p className="field__hint">{tx(P.payOnce)}</p>
      <Field label={tx(P.paidOn)}>
        {(id) => <input id={id} className="input" type="date" dir="ltr" max={billing.today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}
      </Field>
      <Field label={tx(P.method)}>
        {(id) => (
          <select id={id} className="select" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {tx(METHOD_LABEL[m])}
              </option>
            ))}
          </select>
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
