import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { formatDay } from '@/features/instalments/copy'
import { WEEKDAY } from '@/features/trials/copy'
import { parentPath, profileKeys, type StudentProfile } from './api'
import { P, describeError, isProfileRefusal, useCopy } from './copy'
import { useStudent } from './hooks'
import { familyTime, zoneLabel } from '@/core/time/academyTime'
import { SubscriptionPanel } from '@/features/subscriptions/SubscriptionPanel'
import { CarriedOverPanel } from '@/features/intake/CarriedOverPanel'
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
 *
 * The same open file as a parent's, compact: who it is, a strip of facts and
 * the weekly times, then the subscription beside the family.
 */
export function StudentProfilePage() {
  const { learnerId = '' } = useParams<{ learnerId: string }>()
  const tx = useCopy()
  const { locale } = useI18n()
  const student = useStudent(learnerId)
  const data = student.data

  return (
    <div className="page pp">
      <div className="page__inner">
        {isProfileRefusal(student.error) ? (
          <EmptyState icon="lock" title={describeError(student.error, locale)} />
        ) : (
          <QueryBoundary isLoading={student.isLoading} error={student.error} onRetry={() => void student.refetch()}>
            {data && (
              <>
                <StudentFile s={data} />
                <div className="pp-cols pp-student">
                  <div className="pp-main">
                    {/* PD-30: lessons bought and used, the lock, exceptions -- billing readers only (the server decides). */}
                    <SubscriptionPanel learnerId={data.id} />
                  </div>
                  <aside className="pp-side">
                    {data.family && data.family.parents.length > 0 && (
                      <section className="pp-sec" aria-labelledby="st-parents">
                        <div className="pp-sec__head">
                          <h2 id="st-parents" className="pp-sec__title">
                            {tx(P.parents)}
                          </h2>
                        </div>
                        <ul className="pp-rows">
                          {data.family.parents.map((p) => (
                            <li key={p.id} className="pp-row">
                              <Avatar name={p.name} seed={p.id} size="sm" />
                              <Link className="pp-row__name" to={parentPath(p.id)}>
                                <bdi>{p.name}</bdi>
                              </Link>
                            </li>
                          ))}
                        </ul>
                        <p className="pp-rule">{tx(P.parentsHint)}</p>
                      </section>
                    )}
                    {/* PD-42: the package carried over from Jawwid Core -- when the server answers for this viewer. */}
                    <CarriedOverPanel learnerId={data.id} name={data.name} />
                  </aside>
                </div>
              </>
            )}
          </QueryBoundary>
        )}
      </div>
    </div>
  )
}

function StudentFile({ s }: { s: StudentProfile }) {
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
    <>
      <header className="pp-head">
        <div className="pp-head__mark">
          <Avatar name={s.name} seed={s.id} src={s.avatarUrl} size="lg" />
        </div>
        <div className="pp-head__text">
          <p className="pp-head__eyebrow">{tx(P.studentEyebrow)}</p>
          <h1 className="pp-head__name">
            <bdi>{s.name}</bdi>
          </h1>
          {s.family && (
            <p className="pp-head__meta">
              <span dir="auto">{s.family.name}</span>
            </p>
          )}
        </div>
        {mayChangeTeacher && s.teacher && (
          <div className="pp-head__actions">
            <button type="button" className="btn btn--sm" onClick={() => { setDone(null); setChanging(true) }}>
              {otx(O.changeTeacher)}
            </button>
          </div>
        )}
      </header>
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
      <section className="pp-student-info" aria-labelledby="st-info">
        <h2 id="st-info" className="sr-only">
          {tx(P.studentInfo)}
        </h2>
        {done && <p className="banner banner--info" role="status">{done}</p>}
        <div className="pp-strip-wrap">
          <dl className="pp-strip">
            <div>
              <dt>{tx(P.age)}</dt>
              <dd>{s.age === null ? notSet : tx(P.years, { n: s.age })}</dd>
            </div>
            {s.birthDate !== undefined && (
              <div>
                <dt>{tx(P.birthDate)}</dt>
                <dd>{s.birthDate ? formatDay(s.birthDate, locale) : notSet}</dd>
              </div>
            )}
            <div>
              <dt>{tx(P.course)}</dt>
              <dd>{s.course ? <bdi>{s.course.name}</bdi> : notSet}</dd>
            </div>
            <div>
              <dt>{tx(P.teacher)}</dt>
              <dd>{s.teacher ? <bdi>{s.teacher.name}</bdi> : notSet}</dd>
            </div>
          </dl>
        </div>
        <div className="pp-schedule">
          <h3 className="section-label pp-schedule__label">
            {tx(P.schedule)}
            {zones.length === 1 && s.schedule.length > 0 && <span className="pp-schedule__zone">{zoneLabel(zones[0]!, locale)}</span>}
          </h3>
          {s.schedule.length === 0 ? (
            <p className="pp-empty">{tx(P.noSchedule)}</p>
          ) : (
            <ul className="pp-slots">
              {s.schedule.map((x, i) => (
                <li key={i}>
                  {tx(WEEKDAY[x.weekday] ?? { en: String(x.weekday), ar: String(x.weekday) })} · <bdi dir="ltr">{x.start}</bdi> ·{' '}
                  {tx(P.minutes, { n: x.durationMinutes })}
                  {/* PD-22: the family's own clock beside the teacher's, when they differ. */}
                  {(() => {
                    // PD-45 §7: no app clock yet -> the clock the family's country implies, marked approximate.
                    const estimated = !s.familyTimeZone && !!s.familyTimeZoneEstimate
                    const theirs = x.nextStartsAt ? familyTime(x.nextStartsAt, s.familyTimeZone ?? s.familyTimeZoneEstimate, locale) : null
                    return theirs ? <span className="tf-muted"> · {tx(estimated ? P.familyLocalEstimate : P.familyLocal, { time: theirs })}</span> : null
                  })()}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  )
}
