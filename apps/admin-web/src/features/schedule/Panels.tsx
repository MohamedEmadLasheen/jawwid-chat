import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { whenIn, ACADEMY_ZONE } from '@/core/time/academyTime'
import { Dialog } from '@/shared/components/Dialog'
import { studentPath } from '@/features/profiles/api'
import type { CalendarLesson, CalendarStats, Supervisor } from './api'
import { CATEGORY_LABEL, KIND_LABEL, OUTCOME_LABEL, S, STATUS_LABEL, hoursOf, percentOf, useScheduleText } from './copy'
import { PALETTE, isPaletteKey, swatchClass } from './palette'

/**
 * PD-38: the stats bar above the calendar, the legend, and one lesson's
 * details. The stats come from GET /calendar/stats with the calendar's own
 * filters, so the bar and the grid read the same rows.
 */

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'alert' }) {
  return (
    <div className={`metric card sc-tile${tone === 'alert' ? ' metric--alert' : ''}`}>
      {hint && <span className="sc-tile__hint">{hint}</span>}
      <span className="metric__value">{value}</span>
      <span className="metric__label">{label}</span>
    </div>
  )
}

export function StatsBar({ stats, loading }: { stats: CalendarStats | undefined; loading: boolean }) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const h = (m: number) => tx(S.hours, { h: hoursOf(m, locale) })
  if (!stats) {
    return <section className="sc-stats" aria-label={tx(S.statsLabel)} aria-busy={loading} />
  }
  const c = stats.capacity
  const base = c.shiftMinutes - c.inShiftLeaveMinutes
  return (
    <section className="sc-stats-wrap" aria-label={tx(S.statsLabel)} aria-busy={loading}>
      <div className="sc-stats">
        <Tile label={tx(S.teachingHours)} value={h(stats.teaching.bookedMinutes)} hint={tx(S.heldSoFar, { h: hoursOf(stats.teaching.heldMinutes, locale) })} />
        <Tile
          label={tx(S.students)}
          value={String(stats.students.distinct)}
          hint={tx(S.studentsHint, { trial: stats.students.trial, paused: stats.students.paused })}
        />
        <Tile
          label={tx(S.utilization)}
          value={percentOf(c.utilization, locale)}
          hint={base > 0 ? tx(S.utilizationHint, { booked: hoursOf(c.inShiftBookedMinutes, locale), base: hoursOf(base, locale) }) : undefined}
        />
        <Tile label={tx(S.emptyHours)} value={h(c.emptyMinutes)} tone={c.emptyMinutes > 0 ? 'alert' : undefined} />
        <Tile label={tx(S.outsideHours)} value={h(c.outsideMinutes)} />
        <Tile label={tx(S.leaveHours)} value={h(c.inShiftLeaveMinutes)} hint={c.inShiftPausedMinutes > 0 ? `${tx(S.pausedHours)} ${h(c.inShiftPausedMinutes)}` : undefined} />
        {c.workMinutes > 0 && <Tile label={tx(S.freeHours)} value={h(c.freeMinutes)} />}
      </div>
      {stats.lessonFilter && <p className="sc-hint">{tx(S.capacityNote)}</p>}
      {stats.teachers.length > 0 && (
        <details className="sc-byteacher">
          <summary>{tx(S.byTeacher)}</summary>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{tx(S.teacher)}</th>
                  <th scope="col">{tx(S.fCategory)}</th>
                  <th scope="col">{tx(S.colShift)}</th>
                  <th scope="col">{tx(S.colBooked)}</th>
                  <th scope="col">{tx(S.colUsed)}</th>
                  <th scope="col">{tx(S.colRemaining)}</th>
                  <th scope="col">{tx(S.colOutside)}</th>
                  <th scope="col">{tx(S.colLeave)}</th>
                </tr>
              </thead>
              <tbody>
                {stats.teachers.map((t) => (
                  <tr key={t.id}>
                    <th scope="row" dir="auto">{t.name}</th>
                    <td>{tx(CATEGORY_LABEL[t.category])}</td>
                    <td>{t.totals.shiftMinutes > 0 ? h(t.totals.shiftMinutes) : t.totals.workMinutes > 0 ? h(t.totals.workMinutes) : '—'}</td>
                    <td>{h(t.totals.bookedMinutes)}</td>
                    <td>{percentOf(t.utilization, locale)}</td>
                    <td>{t.totals.shiftMinutes > 0 ? h(t.totals.emptyMinutes) : h(t.totals.freeMinutes)}</td>
                    <td>{h(t.totals.outsideMinutes)}</td>
                    <td>{h(t.totals.inShiftLeaveMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  )
}

/**
 * The owner's legend: the supervisors' colors (clicking one filters by that
 * supervisor), then what each line style and band means. Every state is also a
 * shape, never color alone.
 */
export function Legend({
  supervisors,
  selected,
  onToggle,
}: {
  supervisors: Supervisor[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  const tx = useScheduleText()
  return (
    <section className="sc-legend" aria-label={tx(S.legend)}>
      <div className="sc-legend__group" role="group" aria-label={tx(S.supervisorsLegend)}>
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
      <span className="sc-legend__sep" aria-hidden="true" />
      <ul className="sc-legend__group" aria-label={tx(S.statusLegend)}>
        <li><span className="sc-key sc-key--empty" aria-hidden="true" />{tx(S.emptySlot)}</li>
        <li><span className="sc-key sc-key--outside" aria-hidden="true" />{tx(S.outsideShift)}</li>
        <li><span className="sc-key sc-key--leave" aria-hidden="true" />{tx(S.leaveBand)}</li>
        <li><span className="sc-key sc-key--work" aria-hidden="true" />{tx(S.workBand)}</li>
      </ul>
      <span className="sc-legend__sep" aria-hidden="true" />
      <ul className="sc-legend__group" aria-label={tx(S.statusLegend)}>
        <li><span className="sc-key sc-key--trial" aria-hidden="true" />{tx(STATUS_LABEL.trial)}</li>
        <li><span className="sc-key sc-key--active" aria-hidden="true" />{tx(STATUS_LABEL.active)}</li>
        <li><span className="sc-key sc-key--paused" aria-hidden="true" />{tx(STATUS_LABEL.paused)}</li>
      </ul>
    </section>
  )
}

export function LessonDetails({
  lesson,
  supervisors,
  onClose,
}: {
  lesson: CalendarLesson
  supervisors: Supervisor[]
  onClose: () => void
}) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const supervisor = supervisors.find((s) => s.colorKey !== null && s.colorKey === lesson.colorKey)
  const rows: Array<[string, string]> = [
    [tx(S.when), `${whenIn(lesson.startsAt, ACADEMY_ZONE, locale)}–${whenIn(lesson.endsAt, ACADEMY_ZONE, locale).split(' ').pop()}`],
    [tx(S.status), tx(STATUS_LABEL[lesson.status])],
    [tx(S.fKind), tx(KIND_LABEL[lesson.kind])],
  ]
  if (lesson.outsideShift) rows.push([tx(S.outsideShift), '✓'])
  if (!lesson.anonymous) {
    if (lesson.outcome) rows.push([tx(S.outcome), tx(OUTCOME_LABEL[lesson.outcome] ?? { en: lesson.outcome, ar: lesson.outcome })])
    if (lesson.suspendedFor === 'payment') rows.push([tx(S.status), tx(S.paymentHold)])
    if (lesson.movedFrom) rows.push([tx(S.movedHere), '✓'])
  }
  if (supervisor) rows.push([tx(S.fSupervisor), supervisor.name])
  const title = lesson.anonymous
    ? tx(S.anonymousLesson)
    : lesson.learner?.name ?? lesson.prospect?.name ?? tx(S.lessonTitle)
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          {!lesson.anonymous && lesson.learner && (
            <Link className="btn btn--sm" to={studentPath(lesson.learner.id)}>{tx(S.openStudent)}</Link>
          )}
          <button type="button" className="btn btn--sm btn--primary" onClick={onClose}>{tx(S.close)}</button>
        </>
      }
    >
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
