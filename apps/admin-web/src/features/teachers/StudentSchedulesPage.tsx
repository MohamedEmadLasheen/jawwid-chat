import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { O } from './opsCopy'
import { useRoster } from './opsHooks'
import { StudentScheduleDesk, useTx } from './StudentScheduleDesk'
import type { Pair } from './copy'
import './teachers.css'

const COPY = {
  title: { en: 'Student schedules', ar: 'جداول الطلاب' },
  subtitle: {
    en: 'Weekly times, one-off lessons, teacher, pause or stop, for any student.',
    ar: 'المواعيد الأسبوعية والحصص المنفردة والمعلم والإيقاف، لأي طالب.',
  },
  chooseStudent: { en: 'Student', ar: 'الطالب' },
  allStudents: { en: 'All students', ar: 'كل الطلاب' },
  chooseTeacher: { en: 'Teacher', ar: 'المعلم' },
  allTeachers: { en: 'All teachers', ar: 'كل المعلمين' },
  noTeacher: { en: 'No teacher yet', ar: 'بلا معلم بعد' },
} satisfies Record<string, Pair>

const NONE = '__none'

/**
 * Student scheduling: the student-first way into the same scheduling desk the
 * Teachers' schedules page uses (StudentScheduleDesk). Nothing here writes or
 * decides anything of its own -- every change is the shared desk's, checked by
 * the server against the same roster, availability and calendar.
 */
export function StudentSchedulesPage() {
  const tx = useTx()
  const roster = useRoster()
  const [params, setParams] = useSearchParams()
  const studentId = params.get('student') ?? ''
  const teacherId = params.get('teacher') ?? ''

  const { number } = useI18n()
  const learners = roster.data?.learners ?? []
  const unassigned = learners.filter((l) => l.teacherId === null).length
  const teachers = roster.data?.teachers ?? []
  const shown = useMemo(
    () =>
      learners.filter(
        (l) => (!studentId || l.id === studentId) && (!teacherId || (teacherId === NONE ? l.teacherId === null : l.teacherId === teacherId)),
      ),
    [learners, studentId, teacherId],
  )

  const set = (key: 'student' | 'teacher', value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader
          title={tx(COPY.title)}
          subtitle={tx(COPY.subtitle)}
          figures={
            roster.data
              ? [
                  { key: 'students', label: tx(O.students), value: number(learners.length), tone: 'key' },
                  { key: 'none', label: tx(COPY.noTeacher), value: number(unassigned), tone: unassigned > 0 ? 'urgent' : 'quiet', onClick: () => set('teacher', teacherId === NONE ? '' : NONE), pressed: teacherId === NONE },
                ]
              : undefined
          }
        />
        <QueryBoundary isLoading={roster.isLoading} error={roster.error} onRetry={() => void roster.refetch()}>
          <div className="sheet ts-pick">
            <div className="sheet-bar">
            <label className="ts-pick__field">
              <span className="field__label">{tx(COPY.chooseStudent)}</span>
              <SearchableSelect className="select" value={studentId} onValueChange={(v) => set('student', v)} aria-label={tx(COPY.chooseStudent)}>
                <option value="">{tx(COPY.allStudents)}</option>
                {learners.map((l) => (
                  <option key={l.id} value={l.id}>{`${l.name} — ${l.family.displayName}`}</option>
                ))}
              </SearchableSelect>
            </label>
            <label className="ts-pick__field">
              <span className="field__label">{tx(COPY.chooseTeacher)}</span>
              <SearchableSelect className="select" value={teacherId} onValueChange={(v) => set('teacher', v)} aria-label={tx(COPY.chooseTeacher)}>
                <option value="">{tx(COPY.allTeachers)}</option>
                <option value={NONE}>{tx(COPY.noTeacher)}</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </SearchableSelect>
            </label>
            </div>
          </div>
          {learners.length === 0 ? <EmptyState title={tx(O.noStudents)} /> : <StudentScheduleDesk students={shown} teachers={teachers} />}
        </QueryBoundary>
      </div>
    </div>
  )
}
