import { useCallback, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import type { ChangedSignIn } from './api'
import { T, describeError, useCopy } from './copy'
import { Field } from '@/shared/components/Field'
import { FirstLoginCodeDialog } from './AddTeacherDialog'
import { useChangeSignIn } from './hooks'

/**
 * PD-43 §3.3: a new sign-in e-mail, offered when the file's `signIn.canChange`
 * says so. The button stays mounted while its dialog is open, so a code shown
 * once outlives the file's reload.
 */
export function ChangeSignInButton({ show, teacherId, signedIn }: { show: boolean; teacherId: string; signedIn: boolean }) {
  const tx = useCopy()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <>
      {show && (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          {tx(T.changeSignIn)}
        </button>
      )}
      {open && <ChangeSignInDialog teacherId={teacherId} signedIn={signedIn} onClose={close} />}
    </>
  )
}

function ChangeSignInDialog({ teacherId, signedIn, onClose }: { teacherId: string; signedIn: boolean; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const change = useChangeSignIn(teacherId)
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [done, setDone] = useState<ChangedSignIn | null>(null)

  const { isPending, reset } = change
  const close = useCallback(() => {
    if (isPending) return
    reset()
    onClose()
  }, [isPending, reset, onClose])

  if (done?.firstLogin) return <FirstLoginCodeDialog signIn={done.signIn} firstLogin={done.firstLogin} onClose={close} />
  if (done) {
    return (
      <Dialog
        title={tx(T.changeSignIn)}
        onClose={close}
        footer={
          <button type="button" className="btn btn--primary" onClick={close}>
            {tx(T.done)}
          </button>
        }
      >
        <p>{tx(T.signInChanged, { email: done.signIn })}</p>
      </Dialog>
    )
  }

  const missing = (v: string) => (touched && !v.trim() ? tx(T.required) : null)
  const submit = () => {
    setTouched(true)
    if (!email.trim() || !reason.trim()) return
    change.mutate({ email: email.trim(), reason: reason.trim() }, { onSuccess: setDone })
  }

  return (
    <Dialog
      title={tx(T.changeSignIn)}
      onClose={close}
      footer={
        <>
          <DialogCancelButton onClick={close} disabled={isPending} />
          <button type="button" className="btn btn--primary" disabled={isPending} onClick={submit}>
            {isPending ? tx(T.changing) : tx(T.change)}
          </button>
        </>
      }
    >
      <p className="field__hint">{tx(signedIn ? T.changeSignInActiveHint : T.changeSignInWaitingHint)}</p>
      <Field label={tx(T.newSignInEmail)} type="email" value={email} onChange={setEmail} error={missing(email)} />
      <Field label={tx(T.reasonShort)} value={reason} onChange={setReason} multiline error={missing(reason)} />
      {change.error != null && (
        <div className="banner banner--danger" role="alert">
          {describeError(change.error, locale)}
        </div>
      )}
    </Dialog>
  )
}
