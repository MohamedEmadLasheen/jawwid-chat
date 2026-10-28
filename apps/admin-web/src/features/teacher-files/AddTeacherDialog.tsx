import { useCallback, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import type { AddedTeacher, FirstLogin, TeacherOnboardingOffer } from './api'
import { T, describeError, useCopy } from './copy'
import { Field } from './TeacherFileDialogs'
import { useAddTeacher } from './hooks'

/**
 * PD-43: add a teacher. The supervisor choice is the server's (GET
 * /teacher-files `onboarding`): a picker of primary supervisors, or none, for
 * the Teachers manager and the super admin; "Me" or no supervisor for a
 * teacher supervisor (owner N1). On success the first sign-in code is shown
 * ONCE, in its own dialog, and is gone when that closes. While the server is
 * answering the dialog cannot be closed: closing then would lose the code.
 */
export function AddTeacherDialog({
  offer,
  basePath,
  onClose,
}: {
  offer: TeacherOnboardingOffer
  basePath: string
  onClose: () => void
}) {
  const tx = useCopy()
  const add = useAddTeacher()
  const supervisorId = useId()
  // One id per form: a double submit replays the same teacher (chat.create_teacher).
  const [teacherId] = useState(() => crypto.randomUUID())
  const [form, setForm] = useState({ name: '', email: '', phone: '', joinedOn: '' })
  const [supervisor, setSupervisor] = useState<string>(offer.supervisorChoice === 'self_or_none' ? 'self' : '')
  const [touched, setTouched] = useState(false)
  const [added, setAdded] = useState<AddedTeacher | null>(null)
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const missing = (v: string) => (touched && !v.trim() ? tx(T.required) : null)

  // Stable across keystrokes: the Dialog re-focuses whenever onClose changes.
  const { isPending, reset } = add
  const close = useCallback(() => {
    if (isPending) return
    reset()
    onClose()
  }, [isPending, reset, onClose])

  if (added) return <FirstLoginCodeDialog signIn={added.signIn} firstLogin={added.firstLogin} onClose={close} />

  const submit = () => {
    setTouched(true)
    if (!form.name.trim() || !form.email.trim()) return
    add.mutate(
      {
        id: teacherId,
        name: form.name.trim(),
        email: form.email.trim(),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        ...(form.joinedOn ? { joinedOn: form.joinedOn } : {}),
        supervisorId: supervisor === '' ? null : supervisor,
      },
      { onSuccess: setAdded },
    )
  }

  return (
    <Dialog
      title={tx(T.addTeacher)}
      onClose={close}
      footer={
        <>
          <DialogCancelButton onClick={close} disabled={add.isPending} />
          <button type="button" className="btn btn--primary" disabled={add.isPending} onClick={submit}>
            {add.isPending ? tx(T.adding) : tx(T.add)}
          </button>
        </>
      }
    >
      <Field label={tx(T.fullName)} value={form.name} onChange={set('name')} error={missing(form.name)} />
      <Field label={tx(T.signInEmail)} type="email" value={form.email} onChange={set('email')} error={missing(form.email)} />
      <p className="field__hint">{tx(T.signInHint)}</p>
      <Field label={tx(T.phoneOptional)} type="tel" value={form.phone} onChange={set('phone')} />
      <Field label={tx(T.joinedOnOptional)} type="date" value={form.joinedOn} onChange={set('joinedOn')} />

      {offer.supervisorChoice === 'any' ? (
        <div className="field">
          <label className="field__label" htmlFor={supervisorId}>
            {tx(T.supervisor)}
          </label>
          <select id={supervisorId} className="input" value={supervisor} onChange={(e) => setSupervisor(e.target.value)}>
            <option value="">{tx(T.noSupervisorYet)}</option>
            {offer.supervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {supervisor === '' && <span className="field__hint">{tx(T.unsupervisedNote)}</span>}
        </div>
      ) : (
        <fieldset className="field">
          <legend className="field__label">{tx(T.supervisor)}</legend>
          {(['self', ''] as const).map((value) => (
            <label key={value || 'none'} className="tf-radio">
              <input type="radio" name={supervisorId} checked={supervisor === value} onChange={() => setSupervisor(value)} />
              {tx(value === 'self' ? T.me : T.noSupervisorYet)}
            </label>
          ))}
          {supervisor === '' && <span className="field__hint">{tx(T.selfNoneNote)}</span>}
        </fieldset>
      )}

      <AddRefusal error={add.error} basePath={basePath} />
    </Dialog>
  )
}

/** The server's answer; when it names a teacher the caller reaches, a link to their file. */
function AddRefusal({ error, basePath }: { error: unknown; basePath: string }) {
  const { locale } = useI18n()
  if (!error) return null
  const teacher =
    error instanceof ApiError ? ((error.detail as { teacher?: { id: string; name: string } } | null)?.teacher ?? null) : null
  return (
    <div className="banner banner--danger" role="alert">
      {describeError(error, locale)}{' '}
      {teacher && (
        <Link to={`${basePath}/${encodeURIComponent(teacher.id)}`} dir="auto">
          {teacher.name}
        </Link>
      )}
    </div>
  )
}

/**
 * Shown once; closing it drops the code, nothing keeps it. A reissue answered to
 * a teacher supervisor carries no code (owner, "E-mail only; managers can
 * see"): they are told whether it was e-mailed, and to ask the Manager if not.
 */
export function FirstLoginCodeDialog({ signIn, firstLogin, onClose }: { signIn: string; firstLogin: FirstLogin; onClose: () => void }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  return (
    <Dialog
      title={tx(T.firstLoginTitle)}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--primary" onClick={onClose}>
          {tx(T.done)}
        </button>
      }
    >
      {firstLogin.code ? (
        <>
          <p className="field__hint">{tx(T.firstLoginHint)}</p>
          <dl className="tf-code">
            <dt>{tx(T.signInLabel)}</dt>
            <dd dir="ltr">{signIn}</dd>
            <dt>{tx(T.codeLabel)}</dt>
            <dd dir="ltr" className="tf-code__value">
              {firstLogin.code}
            </dd>
          </dl>
          <p className="field__hint">{tx(T.validUntil, { when: dateTime(firstLogin.expiresAt) })}</p>
          <p className="field__hint">{tx(firstLogin.emailed ? T.emailedTo : T.notEmailed)}</p>
        </>
      ) : (
        <p>{tx(firstLogin.emailed ? T.codeEmailed : T.codeNotEmailedAskManager)}</p>
      )}
    </Dialog>
  )
}
