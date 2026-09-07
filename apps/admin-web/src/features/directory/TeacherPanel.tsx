import { useState } from 'react'
import { useAssignTeacher, useTeacherHistory } from './hooks'
import { CurrentSection, HistoryRow, HistorySection } from '@/shared/components/History'
import { splitCurrent } from '@/shared/types/directory'
import { formatDate } from '@/shared/components/History'

/**
 * ONE STUDENT'S TEACHER -- current, and every previous one.
 *
 * This is the `Ahmed → Islam → Mahmoud` requirement on screen: Mahmoud in the
 * current section, Islam in the history section with the date his assignment
 * ended. The two are never merged, and a backfilled row says so rather than
 * implying the academy knows when that teaching actually began.
 */
export function TeacherPanel({
  learnerId,
  familyId,
  canManage,
}: {
  learnerId: string
  familyId: string
  canManage: boolean
}) {
  const history = useTeacherHistory(learnerId)
  const assign = useAssignTeacher(learnerId, familyId)
  const [teacherId, setTeacherId] = useState('')
  const [reason, setReason] = useState('')

  const { current, former } = splitCurrent(history.data?.assignments ?? [])

  return (
    <div className="subpanel">
      <CurrentSection title="Teacher" empty="No teacher assigned.">
        {current.map((a) => (
          <li key={a.id} className="list__row">
            <span className="list__primary">{a.teacherName ?? a.teacherId}</span>
            <span className="muted">since {formatDate(a.startedAt)}</span>
            {a.isBackfilled && (
              <em className="muted" title="Reconstructed at the Phase 3 cutover">
                start date is a migration baseline
              </em>
            )}
          </li>
        ))}
      </CurrentSection>

      <HistorySection title="Previous teachers" empty="No previous teacher.">
        {former.map((a) => (
          <HistoryRow
            key={a.id}
            who={a.teacherName ?? a.teacherId}
            started={a.startedAt}
            ended={a.endedAt}
            reason={a.endedReason ?? a.reason}
            note={a.isBackfilled ? 'start date is a migration baseline' : null}
          />
        ))}
      </HistorySection>

      {canManage && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            assign.mutate({ teacherId, reason })
          }}
        >
          <input
            className="input"
            value={teacherId}
            onChange={(e) => setTeacherId(e.target.value)}
            placeholder="Teacher id"
            aria-label="Teacher id"
          />
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason"
            aria-label="Reason for the assignment"
          />
          <button
            type="submit"
            className="button"
            disabled={!teacherId.trim() || !reason.trim() || assign.isPending}
          >
            {current.length > 0 ? 'Transfer teacher' : 'Assign teacher'}
          </button>
        </form>
      )}
      {assign.isError && <p className="error">{(assign.error as Error).message}</p>}
    </div>
  )
}
