import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { isoToAcademyWallClock } from '@/core/time/academyTime'
import { Dialog } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { studentPath } from '@/features/profiles/api'
import type { CalendarLesson, CalendarStats, Supervisor } from './api'
import { CATEGORY_LABEL, KIND_LABEL, OUTCOME_LABEL, S, STATUS_LABEL, dayLabel, hoursOf, joinList, percentOf, useScheduleText } from './copy'
import { lessonTime } from './Timeline'
import { PALETTE, isPaletteKey, swatchClass } from './palette'

/**
 * PD-38: the view's figures, the by-teacher table, the legend (a "?" in the
 * header) and one lesson's details. The figures come from GET /calendar/stats
 * with the calendar's own filters, so they and the grid read the same rows.
 */

/**
 * Four figures for exactly what is shown, set small beside the filters: how much
 * of the shift time is used (the key one), shift time nobody holds (where a
 * trial can go), booked hours, and leave.
 */
export function Figures({ stats, loading }: { stats: CalendarStats | undefined; loading: boolean }) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  // The figures appear with their numbers, never as an empty frame.
  if (!stats) return null
  const c = stats.capacity
  const base = c.shiftMinutes - c.inShiftLeaveMinutes
  const unit = tx(S.hours, { h: '' }).trim()
  const hours = (m: number) => (
    <>
      <span className="sc-fig__n">{hoursOf(m, locale)}</span> <span className="sc-fig__unit">{unit}</span>
    </>
  )
  return (
    <section className="sc-figs" aria-label={tx(S.statsLabel)} aria-busy={loading}>
      <dl>
        <div className="sc-fig sc-fig--key" title={base > 0 ? tx(S.utilizationHint, { booked: hoursOf(c.inShiftBookedMinutes, locale), base: hoursOf(base, locale) }) : undefined}>
          <dt>{tx(S.utilization)}</dt>
          <dd><span className="sc-fig__n">{percentOf(c.utilization, locale)}</span></dd>
        </div>
        <div className="sc-fig">
          <dt>{tx(S.emptyHours)}</dt>
          <dd>{hours(c.emptyMinutes)}</dd>
        </div>
        <div className="sc-fig" title={tx(S.heldSoFar, { h: hoursOf(stats.teaching.heldMinutes, locale) })}>
          <dt>{tx(S.teachingHours)}</dt>
          <dd>{hours(stats.teaching.bookedMinutes)}</dd>
        </div>
        {c.inShiftLeaveMinutes > 0 && (
          <div className="sc-fig">
            <dt>{tx(S.leaveHours)}</dt>
            <dd>{hours(c.inShiftLeaveMinutes)}</dd>
          </div>
        )}
      </dl>
    </section>
  )
}

/** Each teacher's own figures for the view: a true table, compared down the page. */
export function ByTeacherTable({ stats }: { stats: CalendarStats }) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const h = (m: number) => tx(S.hours, { h: hoursOf(m, locale) })
  return (
    <div className="sc-byteacher">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{tx(S.teacher)}</th>
            <th scope="col" className="num">{tx(S.colShift)}</th>
            <th scope="col" className="num">{tx(S.colBooked)}</th>
            <th scope="col" className="num">{tx(S.colUsed)}</th>
            <th scope="col" className="num">{tx(S.colRemaining)}</th>
            <th scope="col" className="num">{tx(S.colOutside)}</th>
          </tr>
        </thead>
        <tbody>
          {stats.teachers.map((t) => (
            <tr key={t.id}>
              <th scope="row">
                <span className="sc-byteacher__name" dir="auto">{t.name}</span>
                <span className="sc-byteacher__cat">
                  {joinList([tx(CATEGORY_LABEL[t.category]), ...(t.totals.inShiftLeaveMinutes > 0 ? [`${tx(S.colLeave)} ${h(t.totals.inShiftLeaveMinutes)}`] : [])], locale)}
                </span>
              </th>
              <td className="num">{t.totals.shiftMinutes > 0 ? h(t.totals.shiftMinutes) : t.totals.workMinutes > 0 ? h(t.totals.workMinutes) : '—'}</td>
              <td className="num">{h(t.totals.bookedMinutes)}</td>
              <td className="num">{percentOf(t.utilization, locale)}</td>
              <td className="num">{t.totals.shiftMinutes > 0 ? h(t.totals.emptyMinutes) : h(t.totals.freeMinutes)}</td>
              <td className={t.totals.outsideMinutes > 0 ? 'num sc-num--outside' : 'num'}>{h(t.totals.outsideMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A small sample of a lesson's shape, for the legend. */
function Sample({ cls }: { cls: string }) {
  return <span className={`sc-sample ${cls}`} aria-hidden="true" />
}

/**
 * The legend, behind a "?" beside the views: what each lesson shape and lane
 * band means, and the supervisors' colours (choosing one shows only their
 * students). Every state is a shape as well as a colour.
 */
export function LegendHelp({
  supervisors,
  selected,
  onToggle,
}: {
  supervisors: Supervisor[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  const tx = useScheduleText()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])
  return (
    <div className="sc-help" ref={box}>
      <button
        ref={button}
        type="button"
        className="btn btn--icon btn--ghost"
        aria-expanded={open}
        aria-label={tx(S.legendButton)}
        title={tx(S.legendButton)}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="question" size={18} />
      </button>
      {open && (
        <section className="sc-help__panel" aria-label={tx(S.legend)}>
          <h3 className="sc-help__title">{tx(S.legendLessons)}</h3>
          <ul className="sc-help__list">
            <li><Sample cls="sc-c-sky" />{tx(S.scheduled)}</li>
            <li><Sample cls="sc-sample--plain" />{tx(S.noColorLesson)}</li>
            <li><Sample cls="sc-c-sky sc-sample--trial" />{tx(STATUS_LABEL.trial)}</li>
            <li><span className="sc-sample sc-c-sky sc-sample--icon" aria-hidden="true"><Icon name="history" size={13} /></span>{tx(KIND_LABEL.makeup)}</li>
            <li><span className="sc-sample sc-sample--paused sc-sample--icon" aria-hidden="true"><Icon name="pause" size={13} /></span>{tx(STATUS_LABEL.paused)}</li>
            <li><Sample cls="sc-sample--struck" />{tx(S.notHappening)}</li>
            <li><span className="sc-sample sc-c-sky sc-sample--held sc-sample--icon" aria-hidden="true"><Icon name="lock" size={12} /></span>{tx(S.paymentHold)}</li>
            <li><Sample cls="sc-sample--past" />{tx(S.pastLesson)}</li>
            <li><Sample cls="sc-c-sky sc-sample--outside" />{tx(S.outsideShift)}</li>
            <li><span className="sc-sample sc-sample--pair" aria-hidden="true"><span className="sc-c-sky" /><span className="sc-c-green" /></span>{tx(S.clash)}</li>
            <li><Sample cls="sc-sample--ghost" />{tx(S.needsSubstitute)}</li>
          </ul>
          <h3 className="sc-help__title">{tx(S.legendLane)}</h3>
          <ul className="sc-help__list">
            <li><Sample cls="sc-sample--band" />{tx(S.workBand)}</li>
            <li><Sample cls="sc-sample--off" />{tx(S.offHours)}</li>
            <li><Sample cls="sc-sample--leave" />{tx(S.leaveBand)}</li>
            <li><Sample cls="sc-sample--now" />{tx(S.nowLine)}</li>
          </ul>
          {supervisors.length > 0 && (
            <>
              <h3 className="sc-help__title">{tx(S.supervisorsFilter)}</h3>
              <p className="sc-help__hint">{tx(S.supervisorsHint)}</p>
              <div className="sc-help__people" role="group" aria-label={tx(S.supervisorsLegend)}>
                {supervisors.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="sc-legend__sup"
                    aria-pressed={selected.includes(s.id)}
                    onClick={() => onToggle(s.id)}
                    title={isPaletteKey(s.colorKey) ? tx(PALETTE[s.colorKey].name) : tx(S.noColor)}
                  >
                    <span className={`sc-dot ${swatchClass(s.colorKey)}`} aria-hidden="true" />
                    <span dir="auto">{s.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}

export function LessonDetails({
  lesson,
  supervisors,
  teacherName,
  clash,
  uncovered,
  deskAccess,
  onClose,
}: {
  lesson: CalendarLesson
  supervisors: Supervisor[]
  teacherName: string | null
  clash: boolean
  uncovered: boolean
  deskAccess: boolean
  onClose: () => void
}) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const supervisor = supervisors.find((s) => s.colorKey !== null && s.colorKey === lesson.colorKey)
  const rows: Array<[string, string]> = [
    [tx(S.when), joinList([dayLabel(isoToAcademyWallClock(lesson.startsAt).date, locale, { weekday: 'long', day: 'numeric', month: 'long' }), lessonTime(lesson, locale)], locale)],
  ]
  if (teacherName) rows.push([tx(S.teacher), teacherName])
  // The status says something only when it is not the ordinary booked lesson.
  if (lesson.status !== 'active') rows.push([tx(S.status), tx(STATUS_LABEL[lesson.status])])
  rows.push([tx(S.fKind), tx(KIND_LABEL[lesson.kind])])
  if (!lesson.anonymous && lesson.outcome) rows.push([tx(S.outcome), tx(OUTCOME_LABEL[lesson.outcome] ?? { en: lesson.outcome, ar: lesson.outcome })])
  if (supervisor) rows.push([tx(S.fSupervisor), supervisor.name])
  // What needs a person about this lesson, as sentences.
  const notes: Array<{ text: string; urgent: boolean }> = []
  if (uncovered) notes.push({ text: tx(S.needsSubstitute), urgent: true })
  if (clash) notes.push({ text: tx(S.clash), urgent: true })
  if (!lesson.anonymous && lesson.suspendedFor === 'payment') notes.push({ text: tx(S.paymentHold), urgent: true })
  if (lesson.outsideShift) notes.push({ text: tx(S.outsideShift), urgent: false })
  if (!lesson.anonymous && lesson.movedFrom) notes.push({ text: tx(S.movedHere), urgent: false })
  const title = lesson.anonymous ? tx(S.anonymousLesson) : lesson.learner?.name ?? lesson.prospect?.name ?? tx(S.lessonTitle)
  const student = !lesson.anonymous && lesson.learner
  return (
    <Dialog
      title={title}
      variant="sheet"
      onClose={onClose}
      footer={
        <>
          {/* One primary: the desk where a substitute is arranged when the lesson needs one, else the student. */}
          {student && (
            <Link className={`btn btn--sm${uncovered && deskAccess ? '' : ' btn--primary'}`} to={studentPath(student.id)}>{tx(S.openStudent)}</Link>
          )}
          {uncovered && deskAccess && (
            <Link className="btn btn--sm btn--primary" to={`/teachers/schedules?teacher=${encodeURIComponent(lesson.teacherId)}`}>{tx(S.openDesk)}</Link>
          )}
        </>
      }
    >
      {notes.length > 0 && (
        <ul className="sc-details__notes">
          {notes.map((n) => (
            <li key={n.text} className={n.urgent ? 'sc-note sc-note--urgent' : 'sc-note'}>{n.text}</li>
          ))}
        </ul>
      )}
      <dl className="sc-details">
        {rows.map(([k, v]) => (
          <div key={k + v} className="kv">
            <dt className="kv__k">{k}</dt>
            <dd className="kv__v" dir="auto">{v}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}

/** The month's key, under its grid: how full a day is, and its two marks. */
export function HeatKey({ note, onOpenWeek }: { note: string; onOpenWeek: () => void }) {
  const tx = useScheduleText()
  return (
    <div className="sc-heatkey">
      <span className="sc-heatkey__note">
        {note}
        <button type="button" className="sc-attn__action" onClick={onOpenWeek}>{tx(S.openWeek)}</button>
      </span>
      <span className="sc-heatkey__scale" aria-hidden="true">
      <span>{tx(S.heatLess)}</span>
      {[0, 1, 2, 3, 4].map((n) => (
        <span key={n} className={`sc-heatkey__step sc-heat--${n}`} />
      ))}
      <span>{tx(S.heatMore)}</span>
      <span className="sc-heatkey__mark"><span className="sc-heatkey__dot" />{tx(S.outsideShift)}</span>
      <span className="sc-heatkey__mark"><span className="sc-heatkey__step sc-heat--leave" />{tx(S.leaveBand)}</span>
      </span>
    </div>
  )
}
