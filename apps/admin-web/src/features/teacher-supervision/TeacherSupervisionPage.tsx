import { Navigate, useSearchParams } from 'react-router-dom'
import { FilterChips } from '@/shared/components/FilterChips'
import { PageHeader } from '@/shared/components/PageHeader'
import { TeachersTabs } from '@/features/supervision/TeachersTabs'
import { attendancePath } from '@/features/teacher-records/paths'
import { H, useCopy } from './copy'
import { ParentFeedbackSection } from './ParentFeedback'
import { RewardsSection } from './RewardsAndComplaints'
import './teacher-supervision.css'

export type HubSection = 'leave' | 'absences' | 'lateness' | 'rewards' | 'complaints' | 'feedback'
/** What is still on this page until PD-52 PR-4 moves it to Grants & Testimonials. */
const HERE: readonly HubSection[] = ['rewards', 'feedback']
/** PD-52: the sections now on the Attendance & Complaints page, and their names there. */
const MOVED: Partial<Record<HubSection, string>> = { leave: 'leave', absences: 'excuses', lateness: 'lateness', complaints: 'complaints' }

/**
 * PD-26: one page for the Teachers department's supervision. PD-52 splits it:
 * leave, lateness, excuses and absences and complaints are on the Attendance &
 * Complaints page now, and their old links land there (`?section=` mapped,
 * the rest of the query kept). Grants and the parents' feedback stay here
 * until the Grants & Testimonials page (PR-4).
 */
export function TeacherSupervisionPage({ basePath, eyebrow }: { basePath: string; eyebrow?: string }) {
  const tx = useCopy()
  const [params, setParams] = useSearchParams()
  const asked = (params.get('section') ?? 'leave') as HubSection
  const moved = MOVED[asked]
  if (moved || !HERE.includes(asked)) {
    const next = new URLSearchParams(params)
    next.set('section', moved ?? 'leave')
    return <Navigate to={`${attendancePath(basePath)}?${next.toString()}`} replace />
  }
  const section = asked
  const label: Record<string, string> = { rewards: tx(H.rewards), feedback: tx(H.feedback) }

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
          options={HERE.map((s) => ({ value: s, label: label[s] ?? s }))}
        />
        <div className="th-body">
          {section === 'rewards' && <RewardsSection basePath={basePath} />}
          {section === 'feedback' && <ParentFeedbackSection basePath={basePath} />}
        </div>
      </div>
    </div>
  )
}
