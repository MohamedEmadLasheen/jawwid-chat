import { useCallback, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { studentPath } from '@/features/profiles/api'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { QueryBoundary } from '@/shared/components/States'
import type { Reactivated } from './api'
import { T, describeError, useCopy } from './copy'
import { Field } from './TeacherFileDialogs'
import { FirstLoginCodeDialog } from './AddTeacherDialog'
import { useOffboard, useOffboardPreview, useReactivate } from './hooks'

/**
 * PD-43 PR-1b on the Teacher File. Who may is the server's (`onboarding` on
 * the file; the routes re-check). Each button stays mounted while its dialog
 * is open even once the reloaded file no longer offers it: the answer to
 * Reactivate holds a first sign-in code shown once, and must outlive the reload.
 */
export function OffboardButton({ show, teacherId, name }: { show: boolean; teacherId: string; name: string }) {
  const tx = useCopy()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <>
      {show && (
        <button type="button" className="btn btn--danger" onClick={() => setOpen(true)}>
          {tx(T.offboard)}
        </button>
      )}
      {open && <OffboardDialog teacherId={teacherId} name={name} onClose={close} />}
    </>
  )
}

/**
 * The preview first: students still assigned block it (the owner's rule);
 * with none left, a lesson ahead is a trial or the like, listed one by one and
 * cancelled only when the actor ticks the confirmation.
 */
function OffboardDialog({ teacherId, name, onClose }: { teacherId: string; name: string; onClose: () => void }) {
  const tx = useCopy()
  const { locale, dateTime, number } = useI18n()
  const preview = useOffboardPreview(teacherId)
  const offboard = useOffboard(teacherId)
  const confirmId = useId()
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [touched, setTouched] = useState(false)
  const p = preview.data
  const lessons = p?.openLessons ?? []
  const blocked = !p || p.students.length > 0 || !p.isActive
  const ready = !blocked && reason.trim() !== '' && (lessons.length === 0 || confirmed)

  const { isPending } = offboard
  const close = useCallback(() => {
    if (!isPending) onClose()
  }, [isPending, onClose])

  const submit = () => {
    setTouched(true)
    if (!ready) return
    offboard.mutate(
      { reason: reason.trim(), ...(lessons.length > 0 ? { cancelOpenLessons: confirmed } : {}) },
      { onSuccess: onClose },
    )
  }

  const kindLabel = (kind: string) => tx(kind === 'trial' ? T.lessonTrial : kind === 'makeup' ? T.lessonMakeup : T.lessonRegular)

  return (
    <Dialog
      title={tx(T.offboardTitle, { name })}
      onClose={close}
      footer={
        <>
          <DialogCancelButton onClick={close} disabled={isPending} />
          <button type="button" className="btn btn--danger" disabled={!ready || isPending} onClick={submit}>
            {isPending ? tx(T.offboarding) : tx(T.offboard)}
          </button>
        </>
      }
    >
      <p className="field__hint">{tx(T.offboardHint)}</p>
      <QueryBoundary isLoading={preview.isLoading} error={preview.error} onRetry={() => void preview.refetch()}>
        {p && (
          <>
            {!p.isActive && <p className="banner banner--info">{tx(T.alreadyLeft)}</p>}
            {p.students.length > 0 && (
              <div className="banner banner--warn">
                <p>{tx(T.moveStudentsFirst)}</p>
                <ul aria-label={tx(T.studentsStillAssigned)}>
                  {p.students.map((s) => (
                    // Their page has Change teacher.
                    <li key={s.id} dir="auto">
                      <Link to={studentPath(s.id)}>{s.name}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {p.isActive && p.students.length === 0 && lessons.length === 0 && <p>{tx(T.nothingAhead)}</p>}
            {p.students.length === 0 && lessons.length > 0 && (
              <>
                <h3 className="tf-section__title">{tx(T.lessonsAhead)}</h3>
                <ul className="tf-lessons" aria-label={tx(T.lessonsAhead)}>
                  {lessons.map((l) => (
                    <li key={l.id}>
                      {kindLabel(l.kind)} · {dateTime(l.startsAt)}
                    </li>
                  ))}
                </ul>
                <label className="tf-radio" htmlFor={confirmId}>
                  <input id={confirmId} type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  {lessons.length === 1 ? tx(T.confirmCancelOne) : tx(T.confirmCancelMany, { n: number(lessons.length) })}
                </label>
              </>
            )}
            {!blocked && (
              <Field
                label={tx(T.reasonShort)}
                value={reason}
                onChange={setReason}
                multiline
                error={touched && !reason.trim() ? tx(T.required) : null}
              />
            )}
          </>
        )}
      </QueryBoundary>
      {offboard.error != null && (
        <div className="banner banner--danger" role="alert">
          {offboardError(offboard.error, locale, tx)}
        </div>
      )}
    </Dialog>
  )
}

function offboardError(error: unknown, locale: 'ar' | 'en', tx: ReturnType<typeof useCopy>): string {
  if (error instanceof ApiError) {
    if (error.code === 'COMM.TEACHER_HAS_OPEN_LESSONS') {
      const failed = (error.detail as { notCancelled?: unknown[] } | null)?.notCancelled ?? []
      return tx(failed.length > 0 ? T.notCancelled : T.hasOpenLessons)
    }
    if (error.code === 'COMM.TEACHER_HAS_STUDENTS') return tx(T.hasStudents)
    if (error.code === 'COMM.TEACHER_FILE_CONFLICT') return tx(T.alreadyLeft)
  }
  return describeError(error, locale)
}

/** The super admin only (owner Q6); the answer's first sign-in code is shown once. */
export function ReactivateButton({ show, teacherId, name }: { show: boolean; teacherId: string; name: string }) {
  const tx = useCopy()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <>
      {show && (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          {tx(T.reactivate)}
        </button>
      )}
      {open && <ReactivateDialog teacherId={teacherId} name={name} onClose={close} />}
    </>
  )
}

function ReactivateDialog({ teacherId, name, onClose }: { teacherId: string; name: string; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const reactivate = useReactivate(teacherId)
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [done, setDone] = useState<Reactivated | null>(null)

  const { isPending, reset } = reactivate
  const close = useCallback(() => {
    if (isPending) return
    reset()
    onClose()
  }, [isPending, reset, onClose])

  if (done?.signIn && done.firstLogin) return <FirstLoginCodeDialog signIn={done.signIn} firstLogin={done.firstLogin} onClose={close} />
  if (done) {
    return (
      <Dialog
        title={tx(T.reactivateTitle, { name })}
        onClose={close}
        footer={
          <button type="button" className="btn btn--primary" onClick={close}>
            {tx(T.done)}
          </button>
        }
      >
        <p>{tx(T.reactivatedNoSignIn)}</p>
      </Dialog>
    )
  }

  const submit = () => {
    setTouched(true)
    if (!reason.trim()) return
    reactivate.mutate(reason.trim(), { onSuccess: setDone })
  }

  const error = reactivate.error
  return (
    <Dialog
      title={tx(T.reactivateTitle, { name })}
      onClose={close}
      footer={
        <>
          <DialogCancelButton onClick={close} disabled={isPending} />
          <button type="button" className="btn btn--primary" disabled={isPending} onClick={submit}>
            {isPending ? tx(T.reactivating) : tx(T.reactivate)}
          </button>
        </>
      }
    >
      <p className="field__hint">{tx(T.reactivateHint)}</p>
      <Field label={tx(T.reasonShort)} value={reason} onChange={setReason} multiline error={touched && !reason.trim() ? tx(T.required) : null} />
      {error != null && (
        <div className="banner banner--danger" role="alert">
          {error instanceof ApiError && error.code === 'COMM.TEACHER_FILE_CONFLICT' ? tx(T.alreadyActive) : describeError(error, locale)}
        </div>
      )}
    </Dialog>
  )
}
