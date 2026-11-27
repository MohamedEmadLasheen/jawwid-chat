import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Icon } from '@/shared/components/Icon'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { O } from '@/features/teachers/opsCopy'
import { useRoster } from '@/features/teachers/opsHooks'
import { StudentScheduleDesk, useTx } from '@/features/teachers/StudentScheduleDesk'
import type { Pair } from './copy'
import './student-schedules.css'

const COPY = {
  title: { en: 'Student schedules', ar: 'جداول الطلاب' },
  chooseStudent: { en: 'Student', ar: 'الطالب' },
  allStudents: { en: 'All students', ar: 'كل الطلاب' },
  chooseTeacher: { en: 'Teacher', ar: 'المعلم' },
  allTeachers: { en: 'All teachers', ar: 'كل المعلمين' },
  noTeacher: { en: 'No teacher yet', ar: 'بلا معلم بعد' },
  noTeacherCount: { en: 'Students with no teacher yet', ar: 'طلاب بلا معلم بعد' },
  inSchedule: { en: 'See in the schedule', ar: 'اعرضه في الجدول' },
  shown: { en: '{n} of {all} students', ar: '{n} من {all} طالبًا' },
  all: { en: '{n} students', ar: '{n} طالبًا' },
} satisfies Record<string, Pair>

const NONE = '__none'

/**
 * Student schedules: find any student and set their weekly times, a one-off
 * lesson, their teacher, a pause or a stop -- through the same scheduling desk
 * the Teachers' schedules page uses (StudentScheduleDesk). Nothing here writes
 * or decides anything of its own; every change is the shared desk's, checked
 * by the server against the same roster, availability and calendar.
 *
 * The page answers "whose lessons need arranging?": the students with no
 * teacher are a filter at the head of the page (urgent when there are any)
 * and their group comes first; the student and teacher pickers narrow the
 * list, and a narrowed list is one step from the same students on the
 * academy's schedule.
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

  // The same students on the academy's schedule: one teacher's week, or one student's.
  const scheduleLink = studentId
    ? `/schedule?view=week&learnerIds=${encodeURIComponent(studentId)}`
    : teacherId && teacherId !== NONE
      ? `/schedule?view=week&teacherIds=${encodeURIComponent(teacherId)}`
      : null
  const narrowed = !!studentId || !!teacherId

  return (
    <div className="page stu-page">
      <div className="page__inner">
        <header className="page-header mast">
          <div className="mast__row">
            <div className="page-header__text">
              <h1 className="page-header__title">{tx(COPY.title)}</h1>
            </div>
          </div>
        </header>
        <QueryBoundary isLoading={roster.isLoading} error={roster.error} onRetry={() => void roster.refetch()}>
          <div className="stu-toolbar" role="search">
            <label className="stu-pick stu-pick--wide">
              <span className="stu-pick__label sr-only">{tx(COPY.chooseStudent)}</span>
              <SearchableSelect className="select" value={studentId} onValueChange={(v) => set('student', v)} aria-label={tx(COPY.chooseStudent)}>
                <option value="">{tx(COPY.allStudents)}</option>
                {learners.map((l) => (
                  <option key={l.id} value={l.id}>{`${l.name}، ${l.family.displayName}`}</option>
                ))}
              </SearchableSelect>
            </label>
            <label className="stu-pick">
              <span className="stu-pick__label sr-only">{tx(COPY.chooseTeacher)}</span>
              <SearchableSelect className="select" value={teacherId} onValueChange={(v) => set('teacher', v)} aria-label={tx(COPY.chooseTeacher)}>
                <option value="">{tx(COPY.allTeachers)}</option>
                <option value={NONE}>{tx(COPY.noTeacher)}</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </SearchableSelect>
            </label>
            {roster.data && (
              <button
                type="button"
                className={`stu-none${unassigned > 0 ? ' stu-none--urgent' : ''}`}
                aria-pressed={teacherId === NONE}
                aria-label={`${tx(COPY.noTeacherCount)}: ${number(unassigned)}`}
                onClick={() => set('teacher', teacherId === NONE ? '' : NONE)}
              >
                {tx(COPY.noTeacher)}
                {unassigned > 0 && <span className="count count--urgent">{number(unassigned)}</span>}
              </button>
            )}
            <div className="stu-toolbar__end">
              {roster.data && (
                <span className="stu-shown">
                  {narrowed
                    ? tx(COPY.shown).replace('{n}', number(shown.length)).replace('{all}', number(learners.length))
                    : tx(COPY.all).replace('{n}', number(learners.length))}
                </span>
              )}
              {scheduleLink && (
                <Link className="btn btn--sm btn--ghost" to={scheduleLink}>
                  <Icon name="calendar" size={16} />
                  {tx(COPY.inSchedule)}
                </Link>
              )}
            </div>
          </div>
          {learners.length === 0 ? <EmptyState title={tx(O.noStudents)} /> : <StudentScheduleDesk students={shown} teachers={teachers} />}
        </QueryBoundary>
      </div>
    </div>
  )
}
