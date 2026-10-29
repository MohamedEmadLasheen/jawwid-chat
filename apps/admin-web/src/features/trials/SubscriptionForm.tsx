import { useId } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { Pair } from '../teachers/copy'
import type { NewStudentDto, PaymentMethod, ScheduleSlot, SubscriptionFormInput } from './api'
import { CURRENCIES, TR, WEEKDAY } from './copy'
import { useTrialTeachers } from './hooks'
import { readinessNote } from '@/features/teacher-files/readiness'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import './trials.css'

/**
 * Sales' subscription form (trial journey): the parent, each child, the
 * payment. Kept as strings while typed; `toInput` turns it into the request
 * and `formErrors` lists what is missing. The server validates again and has
 * the last word -- this only spares a round trip.
 *
 * Nothing typed here is ever posted in the trial group: it is saved for the
 * New Students page only.
 */
export interface ChildDraft {
  name: string
  age: string
  course: string
  teacherId: string
  packagePrice: string
  lessonPrice: string
  schedule: Array<{ weekday: string; time: string }>
}

export interface SubscriptionDraft {
  parentName: string
  email: string
  phone: string
  children: ChildDraft[]
  currency: string
  method: PaymentMethod | ''
}

export function emptyChild(teacherId = ''): ChildDraft {
  return { name: '', age: '', course: '', teacherId, packagePrice: '', lessonPrice: '', schedule: [{ weekday: '', time: '' }] }
}

export function emptyDraft(teacherId = ''): SubscriptionDraft {
  return { parentName: '', email: '', phone: '', children: [emptyChild(teacherId)], currency: 'EGP', method: '' }
}

/** A recorded form back into a draft, for editing. */
export function draftFrom(s: NewStudentDto): SubscriptionDraft {
  return {
    parentName: s.parent.name,
    email: s.parent.email ?? '',
    phone: s.parent.phone,
    children: s.children.map((c) => ({
      name: c.name,
      age: String(c.age),
      course: c.course,
      teacherId: c.teacher.id,
      packagePrice: String(c.packagePrice),
      lessonPrice: String(c.lessonPrice),
      schedule: c.schedule.map((x) => ({ weekday: String(x.weekday), time: x.time })),
    })),
    currency: s.payment.currency,
    method: s.payment.method,
  }
}

const filled = (v: string) => v.trim() !== ''
const amount = (v: string) => filled(v) && Number.isFinite(Number(v)) && Number(v) >= 0

/** Field ids that are missing or malformed; empty when the draft can be sent. */
export function formErrors(d: SubscriptionDraft): string[] {
  const bad: string[] = []
  if (!filled(d.parentName)) bad.push('parentName')
  if (!filled(d.phone)) bad.push('phone')
  d.children.forEach((c, i) => {
    if (!filled(c.name)) bad.push(`c${i}.name`)
    if (!filled(c.age) || !Number.isInteger(Number(c.age))) bad.push(`c${i}.age`)
    if (!filled(c.course)) bad.push(`c${i}.course`)
    if (!filled(c.teacherId)) bad.push(`c${i}.teacherId`)
    if (!amount(c.packagePrice)) bad.push(`c${i}.packagePrice`)
    if (!amount(c.lessonPrice)) bad.push(`c${i}.lessonPrice`)
    c.schedule.forEach((x, j) => {
      if (!filled(x.weekday)) bad.push(`c${i}.s${j}.weekday`)
      if (!/^\d{2}:\d{2}$/.test(x.time)) bad.push(`c${i}.s${j}.time`)
    })
  })
  if (!/^[A-Za-z]{3}$/.test(d.currency.trim())) bad.push('currency')
  if (d.method === '') bad.push('method')
  return bad
}

export function toInput(d: SubscriptionDraft): SubscriptionFormInput {
  return {
    parent: { name: d.parentName.trim(), email: d.email.trim(), phone: d.phone.trim() },
    children: d.children.map((c) => ({
      name: c.name.trim(),
      age: Number(c.age),
      course: c.course.trim(),
      teacherId: c.teacherId,
      packagePrice: Number(c.packagePrice),
      lessonPrice: Number(c.lessonPrice),
      schedule: c.schedule.map((x): ScheduleSlot => ({ weekday: Number(x.weekday), time: x.time })),
    })),
    payment: { currency: d.currency.trim().toUpperCase(), method: d.method as PaymentMethod },
  }
}

export function SubscriptionForm({
  value,
  onChange,
  showErrors,
}: {
  value: SubscriptionDraft
  onChange: (next: SubscriptionDraft) => void
  /** Mark missing fields once the reader has tried to submit. */
  showErrors: boolean
}) {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const uid = useId()
  const teachers = useTrialTeachers(true)
  const errors = new Set(showErrors ? formErrors(value) : [])
  const set = (patch: Partial<SubscriptionDraft>) => onChange({ ...value, ...patch })
  const setChild = (i: number, patch: Partial<ChildDraft>) =>
    set({ children: value.children.map((c, k) => (k === i ? { ...c, ...patch } : c)) })

  const text = (key: string, label: Pair, v: string, on: (v: string) => void, opts: { type?: string; inputMode?: 'numeric' | 'decimal' | 'tel' | 'email'; dir?: 'ltr' | 'auto' } = {}) => (
    <div className="field">
      <label className="field__label" htmlFor={`${uid}-${key}`}>{tx(label)}</label>
      <input
        id={`${uid}-${key}`}
        className="input"
        type={opts.type ?? 'text'}
        inputMode={opts.inputMode}
        dir={opts.dir ?? 'auto'}
        value={v}
        aria-invalid={errors.has(key)}
        onChange={(e) => on(e.target.value)}
      />
    </div>
  )

  return (
    <div className="tj-form">
      <fieldset className="tj-fieldset">
        <legend className="tj-legend">{tx(TR.parentSection)}</legend>
        {text('parentName', TR.parentName, value.parentName, (v) => set({ parentName: v }))}
        <div className="tj-row">
          {text('phone', TR.parentPhone, value.phone, (v) => set({ phone: v }), { type: 'tel', inputMode: 'tel', dir: 'ltr' })}
          {text('email', TR.parentEmail, value.email, (v) => set({ email: v }), { type: 'email', inputMode: 'email', dir: 'ltr' })}
        </div>
      </fieldset>

      <fieldset className="tj-fieldset">
        <legend className="tj-legend">{tx(TR.childrenSection)}</legend>
        {value.children.map((c, i) => (
          <div className="tj-child" key={i} role="group" aria-label={`${tx(TR.child)} ${i + 1}`}>
            <div className="tj-child__head">
              <span className="tj-child__title">{tx(TR.child)} {i + 1}</span>
              {value.children.length > 1 && (
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => set({ children: value.children.filter((_, k) => k !== i) })}>
                  {tx(TR.removeChild)}
                </button>
              )}
            </div>
            <div className="tj-row">
              {text(`c${i}.name`, TR.childName, c.name, (v) => setChild(i, { name: v }))}
              {text(`c${i}.age`, TR.childAge, c.age, (v) => setChild(i, { age: v }), { type: 'number', inputMode: 'numeric', dir: 'ltr' })}
            </div>
            <div className="tj-row">
              {text(`c${i}.course`, TR.course, c.course, (v) => setChild(i, { course: v }))}
              <div className="field">
                <label className="field__label" htmlFor={`${uid}-c${i}.teacherId`}>{tx(TR.assignedTeacher)}</label>
                <SearchableSelect
                  id={`${uid}-c${i}.teacherId`}
                  className="select"
                  value={c.teacherId}
                  aria-invalid={errors.has(`c${i}.teacherId`)}
                  onValueChange={(v) => setChild(i, { teacherId: v })}
                >
                  <option value="">—</option>
                  {(teachers.data?.teachers ?? []).map((t) => {
                    // PD-43: a warning in the label; every teacher stays pickable (owner Q5).
                    const note = readinessNote(t.readiness, locale)
                    return (
                      <option key={t.id} value={t.id}>{note ? `${t.name} — ${note}` : t.name}</option>
                    )
                  })}
                </SearchableSelect>
                {(() => {
                  const readiness = teachers.data?.teachers.find((t) => t.id === c.teacherId)?.readiness
                  if (!readinessNote(readiness, locale)) return null
                  return (
                    <>
                      <span className="field__hint">{tx(TR.teacherNotReady)}</span>
                      {/* PD-43 §3.7: an unsupervised teacher is the Teachers Manager's. */}
                      {readiness?.noSupervisor && <span className="field__hint">{tx(TR.teacherManagerCovers)}</span>}
                    </>
                  )
                })()}
              </div>
            </div>
            <div className="tj-row">
              {text(`c${i}.packagePrice`, TR.packagePrice, c.packagePrice, (v) => setChild(i, { packagePrice: v }), { type: 'number', inputMode: 'decimal', dir: 'ltr' })}
              {text(`c${i}.lessonPrice`, TR.lessonPrice, c.lessonPrice, (v) => setChild(i, { lessonPrice: v }), { type: 'number', inputMode: 'decimal', dir: 'ltr' })}
            </div>
            <div className="tj-schedule" role="group" aria-label={tx(TR.schedule)}>
              <span className="field__label">{tx(TR.schedule)}</span>
              {c.schedule.map((x, j) => (
                <div className="tj-slot" key={j}>
                  <SearchableSelect
                    className="select"
                    aria-label={tx(TR.weekday)}
                    value={x.weekday}
                    aria-invalid={errors.has(`c${i}.s${j}.weekday`)}
                    onValueChange={(v) => setChild(i, { schedule: c.schedule.map((y, k) => (k === j ? { ...y, weekday: v } : y)) })}
                  >
                    <option value="">{tx(TR.weekday)}</option>
                    {[6, 7, 1, 2, 3, 4, 5].map((d) => (
                      <option key={d} value={d}>{tx(WEEKDAY[d]!)}</option>
                    ))}
                  </SearchableSelect>
                  <input
                    className="input"
                    type="time"
                    aria-label={tx(TR.lessonTime)}
                    dir="ltr"
                    value={x.time}
                    aria-invalid={errors.has(`c${i}.s${j}.time`)}
                    onChange={(e) => setChild(i, { schedule: c.schedule.map((y, k) => (k === j ? { ...y, time: e.target.value } : y)) })}
                  />
                  {c.schedule.length > 1 && (
                    <button type="button" className="btn btn--sm btn--ghost" onClick={() => setChild(i, { schedule: c.schedule.filter((_, k) => k !== j) })}>
                      {tx(TR.removeTime)}
                    </button>
                  )}
                </div>
              ))}
              {c.schedule.length < 14 && (
                <button type="button" className="btn btn--sm" onClick={() => setChild(i, { schedule: [...c.schedule, { weekday: '', time: c.schedule.at(-1)?.time ?? '' }] })}>
                  {tx(TR.addTime)}
                </button>
              )}
            </div>
          </div>
        ))}
        {value.children.length < 10 && (
          <button type="button" className="btn btn--sm" onClick={() => set({ children: [...value.children, emptyChild(value.children[0]?.teacherId ?? '')] })}>
            {tx(TR.addChild)}
          </button>
        )}
      </fieldset>

      <fieldset className="tj-fieldset">
        <legend className="tj-legend">{tx(TR.paymentSection)}</legend>
        <div className="tj-row">
          <div className="field">
            <label className="field__label" htmlFor={`${uid}-currency`}>{tx(TR.currency)}</label>
            <SearchableSelect id={`${uid}-currency`} className="select" value={value.currency} aria-invalid={errors.has('currency')} onValueChange={(v) => set({ currency: v })}>
              {(CURRENCIES as readonly string[]).includes(value.currency) ? null : <option value={value.currency}>{value.currency}</option>}
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </SearchableSelect>
          </div>
          <div className="field" role="radiogroup" aria-label={tx(TR.paymentMethod)} aria-invalid={errors.has('method')}>
            <span className="field__label">{tx(TR.paymentMethod)}</span>
            <div className="tj-choices">
              {(['bank_transfer', 'invoice'] as const).map((m) => (
                <label key={m} className="tj-choice">
                  <input type="radio" name={`${uid}-method`} value={m} checked={value.method === m} onChange={() => set({ method: m })} />
                  {tx(m === 'bank_transfer' ? TR.bankTransfer : TR.invoice)}
                </label>
              ))}
            </div>
          </div>
        </div>
      </fieldset>
      {showErrors && errors.size > 0 && <p className="field__error" role="alert">{tx(TR.fillRequired)}</p>}
    </div>
  )
}
