import { useSearchParams } from 'react-router-dom'
import { FilterChips } from '@/shared/components/FilterChips'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, LoadingState } from '@/shared/components/States'
import { ExcusesSection, LatenessSection, LeaveSection } from '@/features/teacher-supervision/AttendanceSections'
import { ParentFeedbackSection } from '@/features/teacher-supervision/ParentFeedback'
import { ComplaintsSection } from '@/features/teacher-supervision/RewardsAndComplaints'
import { R, useCopy } from './copy'
import { useTeacherRecordsAccess } from './hooks'

export type AttendanceSection = 'leave' | 'lateness' | 'excuses' | 'complaints'
export const ATTENDANCE_SECTIONS: readonly AttendanceSection[] = ['leave', 'lateness', 'excuses', 'complaints']
type ComplaintsView = 'complaints' | 'suggestions'

/**
 * PD-52 page A, Attendance & Complaints (docs/product/pd052-teacher-records-pages-plan.md
 * §5.1, §5.2): leave, lateness, excuses and absences, and complaints -- every
 * source, the parent's app included -- with the parents' suggestions behind a
 * filter (owner, §11 f). The sections are PD-26's, moved; what they offer is
 * GET /teacher-records/access's answer. `basePath` is where the Teacher File
 * links point (the Teachers area, or the super admin's Admin > Teachers).
 *
 * The URL holds the section (`?section=`) and the complaints view (`&view=`),
 * so the old Teacher Supervision links and a Dashboard tile land on theirs.
 */
export function TeacherAttendancePage({ basePath, eyebrow }: { basePath: string; eyebrow?: string }) {
  const tx = useCopy()
  const access = useTeacherRecordsAccess()
  const [params, setParams] = useSearchParams()
  const asked = params.get('section') as AttendanceSection | null
  const section: AttendanceSection = asked && ATTENDANCE_SECTIONS.includes(asked) ? asked : 'leave'
  const view: ComplaintsView = params.get('view') === 'suggestions' ? 'suggestions' : 'complaints'
  const set = (next: Record<string, string>) => setParams(next, { replace: true })
  const label: Record<AttendanceSection, string> = {
    leave: tx(R.leave),
    lateness: tx(R.lateness),
    excuses: tx(R.excuses),
    complaints: tx(R.complaints),
  }

  const a = access.data
  if (access.isLoading) return <LoadingState />
  if (!a || !a.attendance.view) {
    return (
      <div className="page">
        <div className="page__inner">
          <PageHeader eyebrow={eyebrow} title={tx(R.attendanceTitle)} />
          <EmptyState icon="lock" title={tx(R.denied)} />
        </div>
      </div>
    )
  }
  const rights = { canRecord: a.attendance.record, canDecide: a.attendance.decide }

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader eyebrow={eyebrow ?? tx(R.group)} title={tx(R.attendanceTitle)} subtitle={tx(R.attendanceSubtitle)} />
        <FilterChips<AttendanceSection>
          variant="tabs"
          label={tx(R.sections)}
          value={section}
          onChange={(next) => set({ section: next })}
          options={ATTENDANCE_SECTIONS.map((s) => ({ value: s, label: label[s] }))}
        />
        <div className="th-body">
          {section === 'leave' && <LeaveSection basePath={basePath} />}
          {section === 'lateness' && <LatenessSection {...rights} />}
          {section === 'excuses' && <ExcusesSection {...rights} />}
          {section === 'complaints' && (
            <>
              <FilterChips<ComplaintsView>
                label={tx(R.showing)}
                value={view}
                onChange={(next) => set(next === 'complaints' ? { section } : { section, view: next })}
                options={[
                  { value: 'complaints', label: tx(R.complaintsList) },
                  { value: 'suggestions', label: tx(R.suggestions) },
                ]}
              />
              {view === 'complaints' ? <ComplaintsSection /> : <ParentFeedbackSection basePath={basePath} only="suggestion" />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
