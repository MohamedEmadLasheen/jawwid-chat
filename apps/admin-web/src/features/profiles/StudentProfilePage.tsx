import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { formatDay } from '@/features/instalments/copy'
import { WEEKDAY } from '@/features/trials/copy'
import { parentPath, profileKeys, type StudentProfile } from './api'
import { P, describeError, isProfileRefusal, useCopy } from './copy'
import { useStudent } from './hooks'
import { familyTime } from '@/core/time/academyTime'
import { ChangeTeacherDialog } from '@/features/teachers/ChangeTeacherDialog'
import { O } from '@/features/teachers/opsCopy'
import { useMayChangeTeacher } from '@/features/teachers/hooks'
import './profiles.css'

/**
 * PD-17: the Student Profile -- photo, name, age, class schedule, assigned
 * teacher and course. The server opens it to the administration (the Teachers
 * department, the super admin, the child's supervisor) and to the child's own
 * teacher in the app; staff also get the date of birth and the parents, whose
 * Parent Profile then decides by its own rule. Nothing here is money.
 */
export function StudentProfilePage() {
  const { learnerId = '' } = useParams<{ learnerId: string }>()
  const tx = useCopy()
  const { locale } = useI18n()
  const student = useStudent(learnerId)
  const data = student.data

  return (
    <div className="page">
      <div className="page__inner">
        {isProfileRefusal(student.error) ? (
          <EmptyState icon="lock" title={describeError(student.error, locale)} />
        ) : (
          <QueryBoundary isLoading={student.isLoading} error={student.error} onRetry={() => void student.refetch()}>
            {data && (
              <>
                <PageHeader eyebrow={tx(P.studentEyebrow)} title={data.name} />
                <StudentCard s={data} />
                {data.family && data.family.parents.length > 0 && (
                  <section className="card panel tf-section" aria-labelledby="st-parents">
                    <div className="tf-section__head">
                      <h2 id="st-parents" className="tf-section__title">
                        {tx(P.parents)}
                      </h2>
                    </div>
                    <p className="field__hint">{tx(P.parentsHint)}</p>
                    <ul className="pf-people">
                      {data.family.parents.map((p) => (
                        <li key={p.id} className="pf-person">
                          <Avatar name={p.name} seed={p.id} size="sm" />
                          <Link to={parentPath(p.id)} dir="auto">
                            {p.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </QueryBoundary>
        )}
      </div>
    </div>
  )
}

function StudentCard({ s }: { s: StudentProfile }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const otx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const queryClient = useQueryClient()
  // PD-31: "Change teacher" for the administration; the server decides (PD-8 scope).
  const mayChangeTeacher = useMayChangeTeacher()
  const [changing, setChanging] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const notSet = <span className="tf-muted">{tx(P.notSet)}</span>
  const zones = [...new Set(s.schedule.map((x) => x.timezone))]
  return (
    <section className="card panel tf-section" aria-labelledby="st-info">
      <div className="tf-section__head">
        <h2 id="st-info" className="tf-section__title">
          {tx(P.studentInfo)}
        </h2>
        {mayChangeTeacher && s.teacher && (
          <button type="button" className="btn btn--sm" onClick={() => { setDone(null); setChanging(true) }}>
            {otx(O.changeTeacher)}
          </button>
        )}
      </div>
      {done && <p className="banner banner--info" role="status">{done}</p>}
      {changing && (
        <ChangeTeacherDialog
          target={{ kind: 'learner', id: s.id, name: s.name, currentTeacherId: s.teacher?.id ?? null }}
          onClose={() => setChanging(false)}
          onDone={(text) => {
            setChanging(false)
            setDone(text)
            void queryClient.invalidateQueries({ queryKey: profileKeys.student(s.id) })
          }}
        />
      )}
      <div className="pf-contact">
        <div className="pf-photo">
          <Avatar name={s.name} seed={s.id} src={s.avatarUrl} size="lg" />
        </div>
        <dl className="tf-kv pf-kv">
          <dt>{tx(P.name)}</dt>
          <dd>
            <bdi>{s.name}</bdi>
          </dd>
          <dt>{tx(P.age)}</dt>
          <dd>{s.age === null ? notSet : tx(P.years, { n: s.age })}</dd>
          {s.birthDate !== undefined && (
            <>
              <dt>{tx(P.birthDate)}</dt>
              <dd>{s.birthDate ? formatDay(s.birthDate, locale) : notSet}</dd>
            </>
          )}
          <dt>{tx(P.course)}</dt>
          <dd dir="auto">{s.course?.name ?? notSet}</dd>
          <dt>{tx(P.teacher)}</dt>
          <dd dir="auto">{s.teacher?.name ?? notSet}</dd>
          <dt>{tx(P.schedule)}</dt>
          <dd>
            {s.schedule.length === 0 ? (
              <span className="tf-muted">{tx(P.noSchedule)}</span>
            ) : (
              <>
                <ul className="pf-slots">
                  {s.schedule.map((x, i) => (
                    <li key={i}>
                      {tx(WEEKDAY[x.weekday] ?? { en: String(x.weekday), ar: String(x.weekday) })} · <bdi dir="ltr">{x.start}</bdi> ·{' '}
                      {tx(P.minutes, { n: x.durationMinutes })}
                      {/* PD-22: the family's own clock beside the teacher's, when they differ. */}
                      {(() => {
                        const theirs = x.nextStartsAt ? familyTime(x.nextStartsAt, s.familyTimeZone, locale) : null
                        return theirs ? <span className="tf-muted"> · {tx(P.familyLocal, { time: theirs })}</span> : null
                      })()}
                    </li>
                  ))}
                </ul>
                {zones.length === 1 && <span className="field__hint">{tx(P.timezone, { zone: zones[0]! })}</span>}
              </>
            )}
          </dd>
        </dl>
      </div>
    </section>
  )
}
