import { useId, useState, type ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { FilterChips } from '@/shared/components/FilterChips'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { TeacherName } from '@/features/teacher-files/TeacherName'
import { LeaveRequestsList } from '@/features/supervision/LeaveRequestsPage'
import type { Violation, ViolationQuery } from '@/features/discipline/api'
import { describeError } from '@/features/discipline/copy'
import { useViolations } from '@/features/discipline/hooks'
import { ViolationRow } from '@/features/discipline/ViolationRow'
import { AbsenceDialog, DecideDialog, LatenessDialog } from '@/features/discipline/DisciplineDialogs'
import { excuseCategoryLabel } from '@/features/journey/copy'
import '@/features/discipline/discipline.css'
import { AwayBadge } from '@/features/teacher-files/Complaint'
import { H, useCopy } from './copy'
import { useLeaveOverview } from './hooks'
import { SectionIntro } from './SectionIntro'
import './teacher-supervision.css'

/**
 * The attendance sections of PD-52's Attendance & Complaints page (page A):
 * leave, lateness, and excuses and absences. Moved here from PD-26's Teacher
 * Supervision page, not copied: the records and the routes are the same, and
 * the page shell (features/teacher-records) decides which actions to offer
 * from GET /teacher-records/access. The server decides every request again.
 */

/** What the reader may do here: record (lateness, an absence) and decide (the ladder). */
export interface AttendanceRights {
  canRecord: boolean
  canDecide: boolean
}

/** This month in the viewer's calendar -- only the filter's default; the server counts in the academy's. */
function thisMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// 1. Leave
// ---------------------------------------------------------------------------

export function LeaveSection({ basePath }: { basePath: string }) {
  const tx = useCopy()
  const { number, locale } = useI18n()
  const overview = useLeaveOverview()
  const rows = overview.data?.teachers ?? []
  // The balance is the Teachers department's: absent for an Operations-only teacher, and
  // the column with it when no row has one (PD-26 amendment).
  const balances = rows.some((t) => t.used !== undefined)
  return (
    <>
      <SectionIntro hint={tx(H.leaveHint)} />
      {overview.error ? (
        <EmptyState icon="lock" title={describeError(overview.error, locale)} />
      ) : (
        <QueryBoundary isLoading={overview.isLoading} error={null} onRetry={() => void overview.refetch()}>
          {rows.length === 0 ? (
            <EmptyState title={tx(H.empty)} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{tx(H.teacher)}</th>
                    {balances && <th scope="col">{tx(H.balance)}</th>}
                    <th scope="col">{tx(H.status)}</th>
                    <th scope="col">{tx(H.requests)}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td dir="auto">
                        <TeacherName basePath={basePath} teacher={t} />
                      </td>
                      {balances && (
                        <td>
                          {t.used === undefined ? (
                            <span className="th-muted">—</span>
                          ) : t.allowance === null || t.allowance === undefined ? (
                            <span className="th-muted">{tx(H.notTracked, { used: number(t.used) })}</span>
                          ) : (
                            tx(H.balanceOf, { left: number(t.balance ?? 0), allowance: number(t.allowance) })
                          )}
                        </td>
                      )}
                      <td>{t.away ? <AwayBadge away={t.away} /> : <span className="th-muted">{tx(H.available)}</span>}</td>
                      <td>
                        {t.pendingRequests > 0 ? (
                          <Badge tone="warn" dot>
                            {tx(H.pending, { n: number(t.pendingRequests) })}
                          </Badge>
                        ) : (
                          <span className="th-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryBoundary>
      )}
      <h2 className="th-subtitle">{tx(H.leaveRequests)}</h2>
      <LeaveRequestsList basePath={basePath} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 2. Excuses and absences, 3. Lateness -- the discipline ladder's records
// ---------------------------------------------------------------------------

type Window = 'open' | 'month'

function useWindow() {
  const [window, setWindow] = useState<Window>('open')
  const [month, setMonth] = useState(thisMonth())
  return { window, setWindow, month, setMonth }
}

function WindowFilter({ w }: { w: ReturnType<typeof useWindow> }) {
  const tx = useCopy()
  const monthId = useId()
  return (
    <div className="toolbar dc-toolbar">
      <FilterChips<Window>
        label={tx(H.month)}
        value={w.window}
        onChange={w.setWindow}
        options={[
          { value: 'open', label: tx(H.needsDecision) },
          { value: 'month', label: tx(H.thisMonth) },
        ]}
      />
      {w.window === 'month' && (
        <label className="dc-month" htmlFor={monthId}>
          <span className="field__label">{tx(H.month)}</span>
          <input id={monthId} className="input" type="month" value={w.month} onChange={(e) => e.target.value && w.setMonth(e.target.value)} />
        </label>
      )}
    </div>
  )
}

function ViolationTable({
  query,
  canDecide,
  filter,
  extraHead,
  extraCell,
}: {
  query: ViolationQuery
  canDecide: boolean
  filter?: (v: Violation) => boolean
  extraHead?: ReactNode
  extraCell?: (v: Violation) => ReactNode
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const list = useViolations(query)
  const [deciding, setDeciding] = useState<Violation | null>(null)
  const rows = (list.data?.violations ?? []).filter(filter ?? (() => true))
  if (list.error) return <EmptyState icon="lock" title={describeError(list.error, locale)} />
  return (
    <QueryBoundary isLoading={list.isLoading} error={null} onRetry={() => void list.refetch()}>
      {rows.length === 0 ? (
        <EmptyState title={tx(H.empty)} />
      ) : (
        <div className="table-wrap dc-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{tx(H.teacher)}</th>
                {extraHead}
                <th scope="col">{tx(H.what)}</th>
                <th scope="col">{tx(H.step)}</th>
                <th scope="col">{tx(H.action)}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <ViolationRow key={v.id} v={v} onDecide={canDecide ? () => setDeciding(v) : undefined} extra={extraCell?.(v)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {deciding && <DecideDialog violation={deciding} onClose={() => setDeciding(null)} />}
    </QueryBoundary>
  )
}

/** The teacher's apology, a no-show, a late apology and an absence with no lesson -- with PD-50's reason, for staff. */
export function ExcusesSection({ canRecord, canDecide }: AttendanceRights) {
  const tx = useCopy()
  const w = useWindow()
  const [recording, setRecording] = useState(false)
  const query: ViolationQuery = w.window === 'open' ? { state: 'open', kind: 'absences' } : { state: 'all', month: w.month, kind: 'absences' }
  return (
    <>
      <SectionIntro
        hint={tx(H.absencesHint)}
        actions={
          canRecord && (
            <button type="button" className="btn btn--sm" onClick={() => setRecording(true)}>
              {tx(H.recordAbsence)}
            </button>
          )
        }
      />
      <WindowFilter w={w} />
      <ViolationTable
        query={query}
        canDecide={canDecide}
        extraHead={<th scope="col">{tx(H.excuseCategory)}</th>}
        extraCell={(v) => {
          const label = excuseCategoryLabel(v.lesson?.excuseCategory)
          return <td>{label ? tx(label) : <span className="th-muted">—</span>}</td>
        }}
      />
      {recording && <AbsenceDialog onClose={() => setRecording(false)} />}
    </>
  )
}

export function LatenessSection({ canRecord, canDecide }: AttendanceRights) {
  const tx = useCopy()
  const w = useWindow()
  const [type, setType] = useState<'regular' | 'trial'>('regular')
  const [recording, setRecording] = useState(false)
  const query: ViolationQuery = w.window === 'open' ? { state: 'open', kind: 'late' } : { state: 'all', month: w.month, kind: 'late' }
  return (
    <>
      <SectionIntro
        hint={tx(H.latenessHint)}
        actions={
          canRecord && (
            <button type="button" className="btn btn--sm" onClick={() => setRecording(true)}>
              {tx(H.recordLateness)}
            </button>
          )
        }
      />
      {/* The two subsections: trial lessons and regular lessons (PD-26). */}
      <FilterChips<'regular' | 'trial'>
        variant="tabs"
        label={tx(H.lessonType)}
        value={type}
        onChange={setType}
        options={[
          { value: 'regular', label: tx(H.regularLessons) },
          { value: 'trial', label: tx(H.trialLessons) },
        ]}
      />
      <WindowFilter w={w} />
      <ViolationTable
        query={query}
        canDecide={canDecide}
        // An older server sends no lesson kind: everything reads as regular.
        filter={(v) => (v.lesson?.kind ?? 'regular') === type}
        extraHead={
          <>
            <th scope="col">{tx(H.lessonType)}</th>
            <th scope="col">{tx(H.delay)}</th>
          </>
        }
        extraCell={(v) => (
          <>
            <td>{tx(v.lesson?.kind === 'trial' ? H.trial : H.regular)}</td>
            <td>{tx(H.minutes, { n: v.lateMinutes ?? 0 })}</td>
          </>
        )}
      />
      {recording && <LatenessDialog lessonType={type} onClose={() => setRecording(false)} />}
    </>
  )
}

