import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { studentPath } from '@/features/profiles/api'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { QueryBoundary } from '@/shared/components/States'
import { describeError } from '@/features/organization/copy'
import { journeyApi, journeyKeys, type GroupLearner } from './api'
import { J, WEEKDAYS, useJourneyCopy } from './copy'
import './journey.css'

/**
 * PD-15: a group's details, one child at a time -- name, age, course, weekly
 * lesson times, package -- so siblings' courses, times and packages are never
 * confused. The child's supervisor (and the Teachers department, the super
 * admin) edits them; the server says who (`canEdit`).
 */
export function GroupChildren({ conversationId }: { conversationId: string }) {
  const { tx } = useJourneyCopy()
  const q = useQuery({ queryKey: journeyKeys.learners(conversationId), queryFn: () => journeyApi.groupLearners(conversationId) })
  const [editing, setEditing] = useState<GroupLearner | null>(null)
  const learners = q.data?.learners ?? []
  if (!q.isLoading && !q.error && learners.length === 0) return null
  return (
    <section className="dp-section" aria-labelledby={`children-${conversationId}`}>
      <h3 id={`children-${conversationId}`} className="dp-section__title">{tx(J.children)}</h3>
      <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} compact>
        <ul className="jr-children">
          {learners.map((l) => (
            <li key={l.id} className="jr-child">
              <ChildCard l={l} onEdit={() => setEditing(l)} />
            </li>
          ))}
        </ul>
      </QueryBoundary>
      {editing && <EnrollmentDialog learner={editing} conversationId={conversationId} onClose={() => setEditing(null)} />}
    </section>
  )
}

function ChildCard({ l, onEdit }: { l: GroupLearner; onEdit: () => void }) {
  const { tx, locale } = useJourneyCopy()
  const fn = (p: { en: (n: number) => string; ar: (n: number) => string }, n: number) => (locale === 'ar' ? p.ar(n) : p.en(n))
  return (
    <>
      <div className="jr-child__head">
        <strong dir="auto">{l.name}</strong>
        {/* PD-17: the child's Student Profile; the server decides who may open it. */}
        <Link className="btn btn--ghost btn--sm" to={studentPath(l.id)} aria-label={`${tx(J.viewProfile)}: ${l.name}`}>
          {tx(J.viewProfile)}
        </Link>
        {l.canEdit && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onEdit} aria-label={`${tx(J.editDetails)}: ${l.name}`}>
            <Icon name="pencil" size={14} />
            {tx(J.editDetails)}
          </button>
        )}
      </div>
      <dl className="jr-facts jr-facts--compact">
        <dt>{tx(J.age)}</dt>
        <dd>{l.age === null ? tx(J.notSet) : fn(J.years, l.age)}</dd>
        <dt>{tx(J.course)}</dt>
        <dd dir="auto">{l.course?.name ?? tx(J.notSet)}</dd>
        <dt>{tx(J.schedule)}</dt>
        <dd>
          {l.schedule.length === 0 ? (
            tx(J.noSchedule)
          ) : (
            <ul className="jr-slots">
              {l.schedule.map((s, i) => (
                <li key={i}>
                  {tx(WEEKDAYS[s.weekday] ?? { en: String(s.weekday), ar: String(s.weekday) })} · <bdi>{s.start}</bdi> · {fn(J.minutes, s.durationMinutes)}
                </li>
              ))}
            </ul>
          )}
        </dd>
        <dt>{tx(J.packageLessons)}</dt>
        <dd>{l.packageLessons === null ? tx(J.notSet) : fn(J.lessonsCount, l.packageLessons)}</dd>
        <dt>{tx(J.teacher)}</dt>
        <dd dir="auto">{l.teacher?.name ?? tx(J.notSet)}</dd>
      </dl>
    </>
  )
}

/** A child's date of birth, course and package size. Also used from New Students. */
export function EnrollmentDialog({
  learner,
  conversationId,
  onClose,
}: {
  learner: Pick<GroupLearner, 'id' | 'name'> & Partial<Pick<GroupLearner, 'birthDate' | 'course' | 'packageLessons'>>
  conversationId?: string
  onClose: () => void
}) {
  const { tx, locale } = useJourneyCopy()
  const qc = useQueryClient()
  const id = useId()
  const courses = useQuery({ queryKey: journeyKeys.courses, queryFn: journeyApi.courses })
  const [birthDate, setBirthDate] = useState(learner.birthDate ?? '')
  const [courseId, setCourseId] = useState(learner.course?.id ?? '')
  const [packageLessons, setPackageLessons] = useState(learner.packageLessons ? String(learner.packageLessons) : '')
  const [newCourse, setNewCourse] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const options = (courses.data?.courses ?? []).filter((c) => c.isActive || c.id === learner.course?.id)

  const save = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const n = packageLessons.trim() === '' ? null : Number(packageLessons)
      await journeyApi.setEnrollment(learner.id, {
        birthDate: birthDate || null,
        courseId: courseId || null,
        packageLessons: n !== null && Number.isFinite(n) ? Math.trunc(n) : null,
      })
      if (conversationId) void qc.invalidateQueries({ queryKey: journeyKeys.learners(conversationId) })
      void qc.invalidateQueries({ queryKey: ['trials'] })
      onClose()
    } catch (e) {
      setError(e)
      setPending(false)
    }
  }

  const addCourse = async () => {
    if (!newCourse.trim()) return
    setError(null)
    try {
      const c = await journeyApi.createCourse(newCourse.trim())
      await qc.invalidateQueries({ queryKey: journeyKeys.courses })
      setCourseId(c.id)
      setNewCourse('')
    } catch (e) {
      setError(e)
    }
  }

  return (
    <Dialog
      title={locale === 'ar' ? J.detailsTitle.ar(learner.name) : J.detailsTitle.en(learner.name)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={pending} onClick={() => void save()}>
            {pending ? tx(J.saving) : tx(J.save)}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor={`${id}-b`}>{tx(J.birthDate)}</label>
        <input id={`${id}-b`} className="input" type="date" value={birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBirthDate(e.target.value)} />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-c`}>{tx(J.course)}</label>
        <select id={`${id}-c`} className="select" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          <option value="">{tx(J.noCourse)}</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      {courses.data?.canManage && (
        <div className="field">
          <label className="field__label" htmlFor={`${id}-nc`}>{tx(J.addCourse)}</label>
          <div className="jr-row">
            <input id={`${id}-nc`} className="input" dir="auto" maxLength={80} placeholder={tx(J.newCourse)} value={newCourse} onChange={(e) => setNewCourse(e.target.value)} />
            <button type="button" className="btn" disabled={!newCourse.trim()} onClick={() => void addCourse()}>
              <Icon name="plus" size={14} />
              {tx(J.add)}
            </button>
          </div>
        </div>
      )}
      <div className="field">
        <label className="field__label" htmlFor={`${id}-p`}>{tx(J.packageLessons)}</label>
        <input id={`${id}-p`} className="input jr-number" type="number" min={1} max={1000} inputMode="numeric" value={packageLessons} onChange={(e) => setPackageLessons(e.target.value)} />
      </div>
      {error ? <div className="banner banner--danger" role="alert">{describeError(error, locale)}</div> : null}
    </Dialog>
  )
}
