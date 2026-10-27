import { useId, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { FilterChips } from '@/shared/components/FilterChips'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { TeachersTabs } from '@/features/supervision/TeachersTabs'
import { TeacherName } from '@/features/teacher-files/TeacherName'
import { LeaveRequestsList } from '@/features/supervision/LeaveRequestsPage'
import type { Violation, ViolationQuery } from '@/features/discipline/api'
import { describeError } from '@/features/discipline/copy'
import { useViolations } from '@/features/discipline/hooks'
import { ViolationRow } from '@/features/discipline/ViolationRow'
import { AbsenceDialog, DecideDialog, LatenessDialog } from '@/features/discipline/DisciplineDialogs'
import '@/features/discipline/discipline.css'
import { AwayBadge } from '@/features/teacher-files/Complaint'
import { H, useCopy } from './copy'
import { useLeaveOverview } from './hooks'
import { ParentFeedbackSection } from './ParentFeedback'
import { ComplaintsSection, RewardsSection } from './RewardsAndComplaints'
import { SectionIntro } from './SectionIntro'
import './teacher-supervision.css'

export type HubSection = 'leave' | 'absences' | 'lateness' | 'rewards' | 'complaints' | 'feedback'
const SECTIONS: readonly HubSection[] = ['leave', 'absences', 'lateness', 'rewards', 'complaints', 'feedback']

/** This month in the viewer's calendar -- only the filter's default; the server counts in the academy's. */
function thisMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * PD-26: one page for the Teachers department's supervision -- leave,
 * apologies and absences, lateness, rewards, complaints, and (PD-32) the
 * parents' feedback about their child's teacher. Each section is a
 * view over records that already exist (PD-10/11/12/18) and lands on the
 * teacher's file; nothing is typed twice. The section is in the URL, so the
 * old Leave and Discipline links can point straight at theirs.
 */
export function TeacherSupervisionPage({ basePath, eyebrow }: { basePath: string; eyebrow?: string }) {
  const tx = useCopy()
  const [params, setParams] = useSearchParams()
  const asked = params.get('section') as HubSection | null
  const section: HubSection = asked && SECTIONS.includes(asked) ? asked : 'leave'
  const label: Record<HubSection, string> = {
    leave: tx(H.leave),
    absences: tx(H.absences),
    lateness: tx(H.lateness),
    rewards: tx(H.rewards),
    complaints: tx(H.complaints),
    feedback: tx(H.feedback),
  }

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader eyebrow={eyebrow} title={tx(H.title)} subtitle={tx(H.subtitle)} />
        <TeachersTabs basePath={basePath} />
        <FilterChips<HubSection>
          variant="tabs"
          label={tx(H.sections)}
          value={section}
          onChange={(next) => setParams({ section: next }, { replace: true })}
          options={SECTIONS.map((s) => ({ value: s, label: label[s] }))}
        />
        <div className="th-body">
          {section === 'leave' && <LeaveSection basePath={basePath} />}
          {section === 'absences' && <AbsencesSection />}
          {section === 'lateness' && <LatenessSection />}
          {section === 'rewards' && <RewardsSection basePath={basePath} />}
          {section === 'complaints' && <ComplaintsSection />}
          {section === 'feedback' && <ParentFeedbackSection basePath={basePath} />}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 1. Leave
// ---------------------------------------------------------------------------

function LeaveSection({ basePath }: { basePath: string }) {
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
// 2. Apologies and absences, 3. Lateness -- the discipline ladder's records
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
  filter,
  extraHead,
  extraCell,
}: {
  query: ViolationQuery
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
                <ViolationRow key={v.id} v={v} onDecide={() => setDeciding(v)} extra={extraCell?.(v)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {deciding && <DecideDialog violation={deciding} onClose={() => setDeciding(null)} />}
    </QueryBoundary>
  )
}

function AbsencesSection() {
  const tx = useCopy()
  const w = useWindow()
  const [recording, setRecording] = useState(false)
  const query: ViolationQuery = w.window === 'open' ? { state: 'open', kind: 'absences' } : { state: 'all', month: w.month, kind: 'absences' }
  return (
    <>
      <SectionIntro
        hint={tx(H.absencesHint)}
        actions={
          <button type="button" className="btn btn--sm" onClick={() => setRecording(true)}>
            {tx(H.recordAbsence)}
          </button>
        }
      />
      <WindowFilter w={w} />
      <ViolationTable query={query} />
      {recording && <AbsenceDialog onClose={() => setRecording(false)} />}
    </>
  )
}

function LatenessSection() {
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
          <button type="button" className="btn btn--sm" onClick={() => setRecording(true)}>
            {tx(H.recordLateness)}
          </button>
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

