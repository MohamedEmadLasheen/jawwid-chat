import { useCallback, useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import type { TeacherDeletionRequest } from './api'
import { T, describeError, useCopy } from './copy'
import { useCompleteDeletionRequest, useDeletionRequest } from './hooks'

/**
 * PD-56 O-3 (owner, 2026-11-07): the teacher asked, in the app, to delete
 * their account while lessons, students or payroll were open. The banner
 * says by when the account is deleted whatever happens (the worker erases it
 * at the deadline); the super admin and the Teachers manager may close and
 * delete it now, behind a confirmation. Who may is the server's (canComplete;
 * the route re-checks). Nothing shows while there is no pending request, or
 * when the reader may not see it.
 */
export function DeletionRequestBanner({ teacherId, name }: { teacherId: string; name: string }) {
  const tx = useCopy()
  const { date, number, locale } = useI18n()
  const query = useDeletionRequest(teacherId)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const data = query.data
  const request = data?.request
  if (!data || !request || request.state !== 'pending') return null

  return (
    <div className="banner banner--warn" role="region" aria-label={tx(T.deletionRequested)}>
      <p>
        <strong>{tx(T.deletionRequested)}</strong>{' '}
        {tx(T.deletionRequestedBody, { requested: date(request.requestedAt), deadline: date(request.deadlineAt) })}
      </p>
      <p>{stillOpen(data.leftOpen, tx, number, locale === 'ar' ? '، ' : ', ')}</p>
      {data.canComplete && (
        <button type="button" className="btn btn--danger" onClick={() => setOpen(true)}>
          {tx(T.closeAndDelete)}
        </button>
      )}
      {open && <CloseAndDeleteDialog teacherId={teacherId} name={name} leftOpen={data.leftOpen} onClose={close} />}
    </div>
  )
}

function stillOpen(
  left: TeacherDeletionRequest['leftOpen'],
  tx: ReturnType<typeof useCopy>,
  number: (n: number) => string,
  separator: string,
): string {
  if (!left) return ''
  const items = [
    left.futureLessons > 0 ? tx(T.deletionLessonsAhead, { n: number(left.futureLessons) }) : null,
    left.assignedLearners > 0 ? tx(T.deletionStudentsAssigned, { n: number(left.assignedLearners) }) : null,
    left.openPayroll ? tx(T.deletionPayrollOpen) : null,
  ].filter((x): x is string => !!x)
  return items.length ? tx(T.deletionStillOpen, { items: items.join(separator) }) : tx(T.deletionNothingOpen)
}

function CloseAndDeleteDialog({
  teacherId,
  name,
  leftOpen,
  onClose,
}: {
  teacherId: string
  name: string
  leftOpen: TeacherDeletionRequest['leftOpen']
  onClose: () => void
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const complete = useCompleteDeletionRequest(teacherId)
  const confirmId = useId()
  const [confirmed, setConfirmed] = useState(false)
  const { isPending } = complete
  const close = useCallback(() => {
    if (!isPending) onClose()
  }, [isPending, onClose])
  const workLeft = !!leftOpen && (leftOpen.futureLessons > 0 || leftOpen.assignedLearners > 0)

  return (
    <Dialog
      title={tx(T.closeAndDeleteTitle, { name })}
      onClose={close}
      footer={
        <>
          <DialogCancelButton onClick={close} disabled={isPending} />
          <button
            type="button"
            className="btn btn--danger"
            disabled={!confirmed || isPending}
            onClick={() => complete.mutate(undefined, { onSuccess: onClose })}
          >
            {isPending ? tx(T.closingAndDeleting) : tx(T.closeAndDelete)}
          </button>
        </>
      }
    >
      <p className="field__hint">{tx(T.closeAndDeleteHint)}</p>
      {workLeft && <p className="banner banner--warn">{tx(T.closeAndDeleteLeft)}</p>}
      <label className="tf-radio" htmlFor={confirmId}>
        <input id={confirmId} type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        {tx(T.closeAndDeleteConfirm)}
      </label>
      {complete.error != null && (
        <div className="banner banner--danger" role="alert">
          {complete.error instanceof ApiError && complete.error.code === 'COMM.TEACHER_FILE_CONFLICT'
            ? tx(T.deletionNoLongerPending)
            : describeError(complete.error, locale)}
        </div>
      )}
    </Dialog>
  )
}
