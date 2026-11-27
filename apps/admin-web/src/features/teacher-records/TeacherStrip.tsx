import { useId } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import type { MastFigure } from '@/shared/components/PageHeader'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { DECISION_LABEL } from '@/features/discipline/copy'
import type { Decision } from '@/features/discipline/api'
import { teacherFilePath } from '@/features/supervision/TeachersTabs'
import { AwayBadge } from '@/features/teacher-files/Complaint'
import { useSupervisionDirectory } from '@/features/teacher-files/hooks'
import { R, useCopy } from './copy'
import { useTeacherSummary } from './hooks'

/** The teachers the caller works on (the page's own directory), searchable: the control the sheets below answer to. */
export function TeacherPicker({ value, onChange }: { value: string; onChange: (teacherId: string) => void }) {
  const tx = useCopy()
  const id = useId()
  const directory = useSupervisionDirectory()
  return (
    <div className="tr-picker">
      <label className="sr-only" htmlFor={id}>
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
 * PD-52 §5.5: one teacher's facts, computed by the server on read, for the
 * page's masthead: who is chosen and whether they are away, up to four
 * figures, and the way into their file. Counts are of what the caller may
 * see, except the ladder, which is the teacher's. A section the caller's key
 * does not cover comes back null and is left out (review of #374).
 */
export function useTeacherFacts(teacherId: string | null, basePath: string): { status?: ReactNode; figures?: MastFigure[]; action?: ReactNode } {
  const tx = useCopy()
  const { number } = useI18n()
  const summary = useTeacherSummary(teacherId)
  const s = summary.data
  if (!teacherId || !s) return {}
  const ladder = s.ladder
  const step = ladder ? DECISION_LABEL[ladder.nextStep as Decision] : null
  const figures: MastFigure[] = [
    ...(ladder ? [{ key: 'ladder', label: tx(R.figLadder), value: number(ladder.counted), note: tx(R.figNext, { step: step ? tx(step) : ladder.nextStep }) }] : []),
    ...(s.openComplaints !== null ? [{ key: 'complaints', label: tx(R.figOpenComplaints), value: number(s.openComplaints), tone: s.openComplaints > 0 ? ('urgent' as const) : ('quiet' as const) }] : []),
    ...(s.grants !== null ? [{ key: 'grants', label: tx(R.figGrants, { year: s.year }), value: number(s.grants) }] : []),
    ...(s.testimonials !== null ? [{ key: 'testimonials', label: tx(R.figTestimonials, { year: s.year }), value: number(s.testimonials) }] : []),
  ]
  return {
    status: (
      <span className="tr-chosen" role="group" aria-label={s.teacher.name}>
        <Badge tone="info">
          <bdi>{s.teacher.name}</bdi>
        </Badge>
        {ladder && (s.away ? <AwayBadge away={s.away} /> : <Badge tone="ok" dot>{tx(R.available)}</Badge>)}
      </span>
    ),
    figures,
    action: s.opensFile ? (
      <Link className="btn" to={teacherFilePath(basePath, s.teacher.id)}>
        {tx(R.openFile)}
      </Link>
    ) : undefined,
  }
}

/** Not this reader's page: one calm line and a lock, never a red block. */
export function Denied({ text }: { text: string }) {
  return (
    <p className="tr-denied">
      <Icon name="lock" size={18} />
      <span>{text}</span>
    </p>
  )
}
