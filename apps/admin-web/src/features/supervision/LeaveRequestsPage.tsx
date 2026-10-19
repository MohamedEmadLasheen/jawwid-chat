import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import { FilterChips } from '@/shared/components/FilterChips'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { useCalendarDate } from '@/features/teacher-files/calendar'
import type { LeaveRequest, LeaveState } from './api'
import { S, describeError, isSupervisionRefusal, useCopy, type Pair } from './copy'
import { useLeaveRequests } from './hooks'
import { ApproveLeaveDialog, CancelLeaveDialog, DeclineLeaveDialog } from './SupervisionDialogs'
import { TeachersTabs, teacherFilePath } from './TeachersTabs'
import './supervision.css'

type Filter = 'requested' | 'approved' | 'all'

export const LEAVE_STATE: Record<LeaveState, { label: Pair; tone: Tone }> = {
  requested: { label: S.leaveRequested, tone: 'warn' },
  approved: { label: S.leaveApproved, tone: 'ok' },
  declined: { label: S.leaveDeclined, tone: 'outline' },
  withdrawn: { label: S.leaveWithdrawn, tone: 'outline' },
  cancelled: { label: S.leaveCancelled, tone: 'outline' },
}

/** One leave's dates, as the calendar days they are in every time zone. */
export function useLeaveDates() {
  const cal = useCalendarDate()
  return (r: Pick<LeaveRequest, 'firstDay' | 'lastDay'>) =>
    r.firstDay === r.lastDay ? cal.day(r.firstDay) : `${cal.day(r.firstDay)} – ${cal.day(r.lastDay)}`
}

/**
 * PD-12: the leave requests waiting for the Teachers department, oldest first.
 * The row shows what approving would do -- the balance and any lessons inside
 * the leave -- before anyone clicks.
 */
export function LeaveRequestsPage({ basePath, eyebrow }: { basePath: string; eyebrow?: string }) {
  const tx = useCopy()
  const { locale, number } = useI18n()
  const dates = useLeaveDates()
  const [filter, setFilter] = useState<Filter>('requested')
  const list = useLeaveRequests(filter === 'all' ? undefined : filter)
  const [approving, setApproving] = useState<LeaveRequest | null>(null)
  const [declining, setDeclining] = useState<LeaveRequest | null>(null)
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null)
  const rows = list.data?.requests ?? []

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader eyebrow={eyebrow} title={tx(S.leaveTitle)} subtitle={tx(S.leaveSubtitle)} />
        <TeachersTabs basePath={basePath} />
        {isSupervisionRefusal(list.error) ? (
          <EmptyState icon="lock" title={describeError(list.error, locale)} />
        ) : (
          <>
            <div className="toolbar">
              <FilterChips<Filter>
                label={tx(S.leaveTitle)}
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'requested', label: tx(S.leaveRequested) },
                  { value: 'approved', label: tx(S.leaveApproved) },
                  { value: 'all', label: tx(S.stateAll) },
                ]}
              />
            </div>
            <QueryBoundary isLoading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
              {rows.length === 0 ? (
                <EmptyState title={tx(S.noLeave)} />
              ) : (
                <div className="table-wrap sv-table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">{tx(S.teacher)}</th>
                        <th scope="col">{tx(S.dates)}</th>
                        <th scope="col">{tx(S.days)}</th>
                        <th scope="col">{tx(S.reason)}</th>
                        <th scope="col">
                          <span className="sr-only">{tx(S.approve)}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const state = LEAVE_STATE[r.state]
                        const lessons = r.collidingLessons?.length ?? 0
                        return (
                          <tr key={r.id}>
                            <td dir="auto">
                              <Link to={teacherFilePath(basePath, r.teacher.id)}>{r.teacher.name}</Link>
                            </td>
                            <td>{dates(r)}</td>
                            <td>
                              <div className="sv-cell-main">
                                <span>{number(r.days)}</span>
                                {r.state === 'requested' && (
                                  <span className="sv-muted">
                                    {tx(S.balanceNow)}: {r.balance === null || r.balance === undefined ? tx(S.noAllowance) : number(r.balance)}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>
                              <div className="sv-cell-main">
                                <span dir="auto">{r.reason}</span>
                                {r.decisionNote && (
                                  <span className="sv-muted" dir="auto">
                                    {r.decisionNote}
                                  </span>
                                )}
                                {lessons > 0 && (
                                  <Badge tone="warn" dot>
                                    {tx(S.lessonsInside, { n: number(lessons) })}
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td>
                              <div className="sv-actions">
                                {r.state === 'requested' ? (
                                  <>
                                    <button type="button" className="btn btn--primary btn--sm" onClick={() => setApproving(r)}>
                                      {tx(S.approve)}
                                    </button>
                                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDeclining(r)}>
                                      {tx(S.decline)}
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <Badge tone={state.tone} dot>
                                      {tx(state.label)}
                                    </Badge>
                                    {r.state === 'approved' && (
                                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCancelling(r)}>
                                        {tx(S.cancelLeave)}
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </QueryBoundary>
          </>
        )}
        {approving && <ApproveLeaveDialog request={approving} onClose={() => setApproving(null)} />}
        {declining && <DeclineLeaveDialog request={declining} onClose={() => setDeclining(null)} />}
        {cancelling && <CancelLeaveDialog request={cancelling} onClose={() => setCancelling(null)} />}
      </div>
    </div>
  )
}
