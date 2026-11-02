import { useId } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { DECISION_LABEL } from '@/features/discipline/copy'
import type { Decision } from '@/features/discipline/api'
import { teacherFilePath } from '@/features/supervision/TeachersTabs'
import { AwayBadge } from '@/features/teacher-files/Complaint'
import { useSupervisionDirectory } from '@/features/teacher-files/hooks'
import { R, useCopy } from './copy'
import { useTeacherSummary } from './hooks'

/** The teachers the caller works on (the page's own directory), searchable. */
export function TeacherPicker({ value, onChange }: { value: string; onChange: (teacherId: string) => void }) {
  const tx = useCopy()
  const id = useId()
  const directory = useSupervisionDirectory()
  return (
    <div className="field tr-picker">
      <label className="field__label" htmlFor={id}>
        {tx(R.teacher)}
      </label>
      <SearchableSelect id={id} className="input" value={value} onValueChange={(v) => onChange(v)}>
        <option value="">{tx(R.everyTeacher)}</option>
        {(directory.data?.teachers ?? []).map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </SearchableSelect>
    </div>
  )
}

/**
 * PD-52 §5.5: one teacher's strip, computed by the server on read. Counts are
 * of what the caller may see, except the ladder, which is the teacher's.
 */
export function TeacherStrip({ teacherId, basePath }: { teacherId: string | null; basePath: string }) {
  const tx = useCopy()
  const { number } = useI18n()
  const summary = useTeacherSummary(teacherId)
  const s = summary.data
  if (!teacherId || !s) return null
  const step = DECISION_LABEL[s.ladder.nextStep as Decision]
  return (
    <section className="tr-strip" aria-label={s.teacher.name}>
      <strong dir="auto">{s.teacher.name}</strong>
      {s.away ? <AwayBadge away={s.away} /> : <Badge tone="ok">{tx(R.available)}</Badge>}
      <span>{tx(R.ladder, { n: number(s.ladder.counted), step: step ? tx(step) : s.ladder.nextStep })}</span>
      <span>{tx(R.openComplaints, { n: number(s.openComplaints) })}</span>
      <span>{tx(R.yearGrants, { n: number(s.grants), year: s.year })}</span>
      <span>{tx(R.yearTestimonials, { n: number(s.testimonials), year: s.year })}</span>
      {s.opensFile && (
        <Link className="btn btn--sm btn--ghost" to={teacherFilePath(basePath, s.teacher.id)}>
          {tx(R.openFile)}
        </Link>
      )}
    </section>
  )
}
