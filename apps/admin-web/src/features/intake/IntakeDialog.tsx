import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { Badge } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { WEEKDAY } from '@/features/trials/copy'
import { parentPath } from '@/features/profiles/api'
import type { IntakeChildInput, IntakeOptions, IntakeResult, ParentExistsDetail } from './api'
import { I, describeIntakeError, useCopy } from './copy'
import { useAddChildren, useEnterFamily } from './hooks'
import '@/features/trials/trials.css'

interface ChildDraft {
  name: string
  teacherId: string
  course: string
  age: string
  birthDate: string
  schedule: Array<{ weekday: string; time: string }>
  duration: string
  total: string
  completed: string
  planMonths: string
}

const emptyChild = (): ChildDraft => ({
  name: '', teacherId: '', course: '', age: '', birthDate: '', schedule: [], duration: '30', total: '', completed: '', planMonths: '',
})

/** A new id per intake: a retry of the same form is the same intake (the server writes it once). */
function newIntakeId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16))
}

const int = (v: string): number | null => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null)

/** Remaining = total - completed, computed, never typed (owner safeguard S2). */
export function packageNumbers(c: Pick<ChildDraft, 'total' | 'completed'>) {
  const total = int(c.total)
  const completed = int(c.completed)
  if (total === null || completed === null) return null
  return { total, completed, remaining: total - completed }
}

function toChild(c: ChildDraft): IntakeChildInput {
  const pkg = packageNumbers(c)
  return {
    name: c.name.trim(),
    teacherId: c.teacherId || null,
    course: c.course.trim() || null,
    age: int(c.age),
    birthDate: c.birthDate || null,
    schedule: c.schedule.filter((s) => s.weekday && s.time).map((s) => ({ weekday: Number(s.weekday), time: s.time })),
    durationMinutes: int(c.duration) ?? 30,
    carriedOver: pkg ? { total: pkg.total, completed: pkg.completed, planMonths: int(c.planMonths) } : null,
  }
}

type Mode = { kind: 'new' } | { kind: 'add'; familyId: string; familyName: string }

/**
 * PD-42: "Add family" (from the Parents list) and "Add child" (from a Parent
 * Profile) -- the same form. Required: the parent's name, a phone or an
 * e-mail, each child's name (marked); everything else optional. The package a
 * child already has in Core shows its remaining lessons as it is typed, and
 * the numbers are confirmed on a review step before anything is saved.
 * PARENT_EXISTS offers to add the children to that family instead; CHILD_EXISTS
 * asks whether it is another child.
 */
export function IntakeDialog({ options, initial, onClose }: { options: IntakeOptions; initial: Mode; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const uid = useId()
  const [mode, setMode] = useState<Mode>(initial)
  const [intakeId, setIntakeId] = useState(newIntakeId)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [country, setCountry] = useState('')
  const [onBehalfOf, setOnBehalfOf] = useState('')
  const [children, setChildren] = useState<ChildDraft[]>([emptyChild()])
  const [confirmOver, setConfirmOver] = useState(false)
  const [confirmDuplicate, setConfirmDuplicate] = useState(false)
  const [step, setStep] = useState<'edit' | 'review'>('edit')
  const [tried, setTried] = useState(false)
  const [result, setResult] = useState<IntakeResult | null>(null)
  const enter = useEnterFamily()
  const add = useAddChildren(mode.kind === 'add' ? mode.familyId : '')
  const pending = enter.isPending || add.isPending
  const error = mode.kind === 'add' ? add.error : enter.error

  const isNew = mode.kind === 'new'
  const needsOnBehalf = isNew && options.onBehalfOf.length > 0 && options.standing !== 'operations_supervisor' && options.standing !== 'sales_member'
  const over = children.some((c) => {
    const p = packageNumbers(c)
    return p !== null && p.completed > p.total
  })
  const problems: string[] = []
  if (isNew && !name.trim()) problems.push('name')
  if (isNew && !phone.trim() && !email.trim()) problems.push('channel')
  if (needsOnBehalf && !onBehalfOf) problems.push('onBehalf')
  children.forEach((c, i) => {
    if (!c.name.trim()) problems.push(`c${i}.name`)
    if (c.schedule.some((s) => s.weekday && s.time) && !c.teacherId) problems.push(`c${i}.times`)
    if ((c.total.trim() !== '') !== (c.completed.trim() !== '')) problems.push(`c${i}.package`)
  })
  if (over && (!options.manager || !confirmOver)) problems.push('over')
  const bad = (key: string) => tried && problems.includes(key)

  const setChild = (i: number, patch: Partial<ChildDraft>) => setChildren((cs) => cs.map((c, k) => (k === i ? { ...c, ...patch } : c)))

  const review = () => {
    setTried(true)
    if (problems.length === 0) setStep('review')
  }

  const save = () => {
    const list = children.map(toChild)
    const done = (r: IntakeResult) => setResult(r)
    if (mode.kind === 'new') {
      enter.mutate(
        {
          intakeId,
          parent: { name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, country: country || null },
          children: list,
          onBehalfOf: needsOnBehalf ? onBehalfOf : null,
          confirmOver: over && confirmOver,
        },
        { onSuccess: done },
      )
    } else {
      add.mutate({ intakeId, children: list, confirmDuplicate, confirmOver: over && confirmOver }, { onSuccess: done })
    }
  }

  // PARENT_EXISTS with a family this viewer may handle: add the children there instead.
  const exists = error instanceof ApiError && error.code === 'COMM.PARENT_EXISTS' ? (error.detail as ParentExistsDetail | undefined) : undefined
  const childExists = error instanceof ApiError && error.code === 'COMM.CHILD_EXISTS'
  const switchToFamily = (d: ParentExistsDetail) => {
    setMode({ kind: 'add', familyId: d.familyId, familyName: d.parentName ?? '' })
    setIntakeId(newIntakeId())
    enter.reset()
    setStep('review')
  }

  const title = isNew ? tx(I.newTitle) : `${tx(I.addTitle)} ${mode.kind === 'add' ? mode.familyName : ''}`

  if (result) {
    const failed = result.schedules.filter((x) => !x.set)
    return (
      <Dialog title={title} onClose={onClose} footer={<button type="button" className="btn btn--primary" onClick={onClose}>{tx(I.close)}</button>}>
        <div className="banner banner--ok" role="status">{tx(isNew ? I.done : I.doneChild)}</div>
        {result.supervision === 'needs_operations_supervisor' && <p className="field__hint">{tx(I.needsSupervisor)}</p>}
        {failed.length > 0 && (
          <p className="field__hint">
            {tx(I.timesNotSet)} {failed.length}: {failed.map((x) => x.reason).filter(Boolean).join(' · ')}
          </p>
        )}
        {result.contactId && (
          <p>
            <Link className="btn btn--sm" to={parentPath(result.contactId)} onClick={onClose}>{tx(I.openParent)}</Link>
          </p>
        )}
      </Dialog>
    )
  }

  const field = (key: string, label: string, control: (id: string) => ReactNode, opts: { required?: boolean; hint?: string; error?: string } = {}) => (
    <div className="field">
      <label className="field__label" htmlFor={`${uid}-${key}`}>
        {label}
        {opts.required && <span className="field__required" aria-label={tx(I.required)}> *</span>}
      </label>
      {control(`${uid}-${key}`)}
      {opts.hint && <span className="field__hint">{opts.hint}</span>}
      {opts.error && <span className="field__error">{opts.error}</span>}
    </div>
  )

  const footer = step === 'edit' ? (
    <>
      <DialogCancelButton onClick={onClose} />
      <button type="button" className="btn btn--primary" onClick={review}>{tx(I.review)}</button>
    </>
  ) : (
    <>
      <button type="button" className="btn" onClick={() => setStep('edit')} disabled={pending}>{tx(I.back)}</button>
      <button type="button" className="btn btn--primary" onClick={save} disabled={pending}>{pending ? tx(I.saving) : tx(I.save)}</button>
    </>
  )

  return (
    <Dialog title={title} onClose={onClose} variant="sheet" footer={footer}>
      {error && (
        <div className="banner banner--danger" role="alert">
          <p>{describeIntakeError(error, locale)}</p>
          {exists?.familyId && (
            <button type="button" className="btn btn--sm" onClick={() => switchToFamily(exists)}>
              {tx(I.addToFamily)}{exists.parentName ? ` — ${exists.parentName}` : ''}
            </button>
          )}
          {error instanceof ApiError && error.code === 'COMM.PARENT_EXISTS' && !exists?.familyId && <p>{tx(I.parentExistsAsk)}</p>}
          {childExists && (
            <label className="checkbox">
              <input type="checkbox" checked={confirmDuplicate} onChange={(e) => setConfirmDuplicate(e.target.checked)} />
              <span>{tx(I.confirmTwin)}</span>
            </label>
          )}
        </div>
      )}

      {step === 'review' ? (
        <div className="tj-form" aria-label={tx(I.reviewTitle)}>
          <h3 className="tj-legend">{tx(I.reviewTitle)}</h3>
          {isNew && (
            <p dir="auto">
              <strong>{name}</strong> · <span dir="ltr">{[phone, email].filter(Boolean).join(' · ')}</span>
            </p>
          )}
          <ul className="pf-people">
            {children.map((c, i) => {
              const p = packageNumbers(c)
              return (
                <li key={i}>
                  <span dir="auto">{c.name}</span>
                  {' — '}
                  {p ? (
                    <span data-testid={`review-package-${i}`}>
                      {tx(I.total)} {p.total} · {tx(I.completed)} {p.completed} · {tx(I.remaining)} {Math.max(p.remaining, 0)}
                      {p.remaining < 0 ? ` (${tx(I.overBy)} ${-p.remaining})` : ''}
                      {int(c.planMonths) ? ` · ${int(c.planMonths)} ${tx(I.months)}` : ''}
                    </span>
                  ) : (
                    tx(I.noPackage)
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <div className="tj-form">
          {isNew && <p className="field__hint">{tx(I.intro)}</p>}
          {isNew && (
            <fieldset className="tj-fieldset">
              <legend className="tj-legend">{tx(I.parentSection)}</legend>
              {field('name', tx(I.parentName), (id) => (
                <input id={id} className="input" dir="auto" value={name} aria-invalid={bad('name')} onChange={(e) => setName(e.target.value)} />
              ), { required: true, error: bad('name') ? tx(I.required) : undefined })}
              <div className="tj-row">
                {field('phone', tx(I.phone), (id) => (
                  <input id={id} className="input" type="tel" inputMode="tel" dir="ltr" value={phone} aria-invalid={bad('channel')} onChange={(e) => setPhone(e.target.value)} />
                ), { required: true, hint: tx(I.phoneHint) })}
                {field('country', tx(I.country), (id) => (
                  <select id={id} className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
                    <option value="">{tx(I.choose)}</option>
                    {['EG', 'AE', 'SA', 'KW', 'QA', 'BH', 'OM', 'JO', 'GB', 'US', 'CA', 'AU', 'DE', 'FR'].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ), { hint: tx(I.countryHint) })}
              </div>
              {field('email', tx(I.email), (id) => (
                <input id={id} className="input" type="email" inputMode="email" dir="ltr" value={email} aria-invalid={bad('channel')} onChange={(e) => setEmail(e.target.value)} />
              ), { required: true, error: bad('channel') ? tx(I.oneChannel) : undefined })}
              {needsOnBehalf && field('onBehalf', tx(I.onBehalf), (id) => (
                <select id={id} className="input" value={onBehalfOf} aria-invalid={bad('onBehalf')} onChange={(e) => setOnBehalfOf(e.target.value)}>
                  <option value="">{tx(I.choose)}</option>
                  {options.onBehalfOf.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              ), { required: true, hint: tx(I.onBehalfHint), error: bad('onBehalf') ? tx(I.required) : undefined })}
            </fieldset>
          )}

          <fieldset className="tj-fieldset">
            <legend className="tj-legend">{tx(I.childrenSection)}</legend>
            {children.map((c, i) => {
              const p = packageNumbers(c)
              return (
                <div className="tj-child" key={i} role="group" aria-label={`${tx(I.child)} ${i + 1}`}>
                  <div className="tj-child__head">
                    <span className="tj-child__title">{tx(I.child)} {i + 1}</span>
                    {children.length > 1 && (
                      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setChildren((cs) => cs.filter((_, k) => k !== i))}>{tx(I.remove)}</button>
                    )}
                  </div>
                  <div className="tj-row">
                    {field(`c${i}.name`, tx(I.childName), (id) => (
                      <input id={id} className="input" dir="auto" value={c.name} aria-invalid={bad(`c${i}.name`)} onChange={(e) => setChild(i, { name: e.target.value })} />
                    ), { required: true, error: bad(`c${i}.name`) ? tx(I.required) : undefined })}
                    {field(`c${i}.teacher`, tx(I.teacher), (id) => (
                      <select id={id} className="input" value={c.teacherId} onChange={(e) => setChild(i, { teacherId: e.target.value })}>
                        <option value="">{tx(I.noTeacher)}</option>
                        {options.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    ))}
                  </div>
                  <div className="tj-row">
                    {field(`c${i}.course`, tx(I.course), (id) => <input id={id} className="input" dir="auto" value={c.course} onChange={(e) => setChild(i, { course: e.target.value })} />)}
                    {field(`c${i}.age`, tx(I.age), (id) => <input id={id} className="input" type="number" inputMode="numeric" dir="ltr" value={c.age} onChange={(e) => setChild(i, { age: e.target.value })} />)}
                    {field(`c${i}.birth`, tx(I.birthDate), (id) => <input id={id} className="input" type="date" dir="ltr" value={c.birthDate} onChange={(e) => setChild(i, { birthDate: e.target.value })} />)}
                  </div>
                  <div className="field">
                    <span className="field__label">{tx(I.times)}</span>
                    {c.schedule.map((s, j) => (
                      <div className="tj-row" key={j}>
                        <select className="input" aria-label={`${tx(I.times)} ${j + 1}`} value={s.weekday} onChange={(e) => setChild(i, { schedule: c.schedule.map((x, k) => (k === j ? { ...x, weekday: e.target.value } : x)) })}>
                          <option value="">{tx(I.choose)}</option>
                          {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{locale === 'ar' ? WEEKDAY[d]!.ar : WEEKDAY[d]!.en}</option>)}
                        </select>
                        <input className="input" type="time" dir="ltr" aria-label={`${tx(I.times)} ${j + 1}`} value={s.time} onChange={(e) => setChild(i, { schedule: c.schedule.map((x, k) => (k === j ? { ...x, time: e.target.value } : x)) })} />
                        <button type="button" className="btn btn--sm btn--ghost" onClick={() => setChild(i, { schedule: c.schedule.filter((_, k) => k !== j) })}>{tx(I.remove)}</button>
                      </div>
                    ))}
                    <button type="button" className="btn btn--sm" onClick={() => setChild(i, { schedule: [...c.schedule, { weekday: '', time: '' }] })}>{tx(I.addTime)}</button>
                    {bad(`c${i}.times`) && <span className="field__error">{tx(I.timesNeedTeacher)}</span>}
                  </div>
                  {c.schedule.length > 0 && field(`c${i}.duration`, tx(I.duration), (id) => (
                    <input id={id} className="input" type="number" inputMode="numeric" dir="ltr" value={c.duration} onChange={(e) => setChild(i, { duration: e.target.value })} />
                  ))}

                  <fieldset className="tj-fieldset">
                    <legend className="tj-legend">{tx(I.packageSection)}</legend>
                    <p className="field__hint">{tx(I.packageHint)}</p>
                    <div className="tj-row">
                      {field(`c${i}.total`, tx(I.total), (id) => (
                        <input id={id} className="input" type="number" inputMode="numeric" dir="ltr" value={c.total} aria-invalid={bad(`c${i}.package`)} onChange={(e) => setChild(i, { total: e.target.value })} />
                      ))}
                      {field(`c${i}.completed`, tx(I.completed), (id) => (
                        <input id={id} className="input" type="number" inputMode="numeric" dir="ltr" value={c.completed} aria-invalid={bad(`c${i}.package`)} onChange={(e) => setChild(i, { completed: e.target.value })} />
                      ))}
                      {field(`c${i}.plan`, tx(I.planMonths), (id) => (
                        <input id={id} className="input" type="number" inputMode="numeric" dir="ltr" value={c.planMonths} onChange={(e) => setChild(i, { planMonths: e.target.value })} />
                      ))}
                    </div>
                    {p && (
                      <p data-testid={`remaining-${i}`}>
                        {tx(I.remaining)}: <strong>{Math.max(p.remaining, 0)}</strong>{' '}
                        <Badge tone={p.remaining > 0 ? 'ok' : 'warn'}>{p.remaining > 0 ? tx(I.active) : tx(I.usedUp)}</Badge>
                        {p.remaining < 0 && <> · {tx(I.overBy)} {-p.remaining}</>}
                      </p>
                    )}
                  </fieldset>
                </div>
              )
            })}
            <button type="button" className="btn btn--sm" onClick={() => setChildren((cs) => [...cs, emptyChild()])}>{tx(I.addAnotherChild)}</button>
          </fieldset>

          {over && (
            <div className="banner banner--warn">
              <p>{tx(I.overManagers)}</p>
              {options.manager && (
                <label className="checkbox">
                  <input type="checkbox" checked={confirmOver} onChange={(e) => setConfirmOver(e.target.checked)} />
                  <span>{tx(I.confirmOver)}</span>
                </label>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
