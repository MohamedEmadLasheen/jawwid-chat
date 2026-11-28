import { useMemo, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ACADEMY_ZONE, clock12In, isoToAcademyWallClock } from '@/core/time/academyTime'
import type { CalendarDay, CalendarLesson, CalendarSummary, CalendarWindow } from './api'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { CATEGORY_LABEL, KIND_LABEL, S, STATUS_LABEL, dayLabel, hoursOf, joinList, lessonsCount, statusOf, useScheduleText } from './copy'
import type { Findings } from './issues'
import { lessonClasses, lessonLabel, lessonName, lessonTime } from './Timeline'
import { daysOf } from './viewState'

/**
 * PD-38 on a phone (owner, 2026-10-28): the same data as the grids, as a list.
 * One section per day under a date bar that stays at the top while it scrolls;
 * in it, each teacher with something that day -- their lessons and the shift
 * time no student holds, in time order, every row a full-width target of at
 * least 44 px. A lesson opens the same details as on the grid, and wears the
 * same shapes (edge, dashed trial, struck, ghost, clash outline).
 */

type Row =
  | { kind: 'lesson'; at: string; lesson: CalendarLesson }
  | { kind: 'empty'; at: string; to: string }
  | { kind: 'leave' }

function rowsOf(day: CalendarDay | undefined, lessons: CalendarLesson[]): Row[] {
  const rows: Row[] = [
    ...lessons.map((l): Row => ({ kind: 'lesson', at: l.startsAt, lesson: l })),
    ...(day?.empty ?? []).map(([from, to]): Row => ({ kind: 'empty', at: from, to })),
  ].sort((a, b) => ('at' in a ? a.at : '').localeCompare('at' in b ? b.at : ''))
  return (day?.leave.length ?? 0) > 0 ? [{ kind: 'leave' }, ...rows] : rows
}

export function AgendaView({
  data,
  findings,
  now,
  onLesson,
}: {
  data: CalendarWindow
  findings: Findings
  now: string
  onLesson: (l: CalendarLesson) => void
}) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const byDay = useMemo(() => {
    const lessons = new Map<string, CalendarLesson[]>()
    for (const l of data.lessons) {
      const k = `${l.teacherId}|${isoToAcademyWallClock(l.startsAt).date}`
      lessons.set(k, [...(lessons.get(k) ?? []), l])
    }
    return { lessons, days: new Map(data.days.map((d) => [`${d.teacherId}|${d.day}`, d])) }
  }, [data])
  // Today opens at now: what is already over folds behind one line per teacher.
  const today = isoToAcademyWallClock(now).date
  const nowMs = Date.parse(now)
  const over = (r: Row) => (r.kind === 'lesson' ? Date.parse(r.lesson.endsAt) <= nowMs : r.kind === 'empty' ? Date.parse(r.to) <= nowMs : false)
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set())

  return (
    <div className="sc-agenda">
      {daysOf(data.from, data.to).map((day) => {
        const teachers = data.teachers
          .map((t) => ({ t, rows: rowsOf(byDay.days.get(`${t.id}|${day}`), byDay.lessons.get(`${t.id}|${day}`) ?? []) }))
          .filter((x) => x.rows.length > 0)
        const headingId = `sc-agenda-${day}`
        return (
          <section key={day} className="sc-agenda__day" aria-labelledby={headingId}>
            <h3 id={headingId} className="sc-agenda__date">
              {dayLabel(day, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
              {day === today && (
                <span className="sc-agenda__now">
                  {tx(S.nowLine)} <bdi>{clock12In(now, ACADEMY_ZONE, locale)}</bdi>
                </span>
              )}
            </h3>
            {teachers.length === 0 && <p className="sc-muted sc-agenda__none">{tx(S.noLessonsDay)}</p>}
            {teachers.map(({ t, rows: all }) => {
              const key = `${t.id}|${day}`
              const fold = day === today && !unfolded.has(key)
              const folded = fold ? all.filter(over).filter((r) => r.kind === 'lesson').length : 0
              const rows = fold ? all.filter((r) => !over(r)) : all
              return (
              <div key={t.id} className="sc-agenda__teacher">
                <div className="sc-agenda__who">
                  <span className="sc-agenda__teacher-name"><bdi>{t.name}</bdi></span>
                  {findings.absent.has(`${t.id}|${day}`) ? (
                    <Badge tone="neutral">{tx(S.onLeave)}</Badge>
                  ) : (
                    <span className="sc-cat">{tx(CATEGORY_LABEL[t.category])}</span>
                  )}
                </div>
                {folded > 0 && (
                  <button type="button" className="sc-agenda__more" onClick={() => setUnfolded(new Set([...unfolded, key]))}>
                    {tx(S.pastLessons, { n: lessonsCount(folded, locale) })}
                  </button>
                )}
                <ul className="sc-agenda__list">
                  {(() => {
                    const free = rows.filter((r): r is Extract<Row, { kind: 'empty' }> => r.kind === 'empty')
                    return free.length > 0 ? (
                      <li className="sc-agenda__empty">
                        <span className="sc-agenda__free-label">{tx(S.availableSlot)}</span>
                        <span className="sc-agenda__free">
                          {joinList(free.map((r) => `${clock12In(r.at, ACADEMY_ZONE, locale)} – ${clock12In(r.to, ACADEMY_ZONE, locale)}`), locale)}
                        </span>
                      </li>
                    ) : null
                  })()}
                  {rows.filter((r) => r.kind !== 'empty').map((r) =>
                    r.kind === 'lesson' ? (
                      <li key={r.lesson.id}>
                        {(() => {
                          const l = r.lesson
                          const miss = data.lessonFilter && !l.matches
                          const clash = findings.clashing.has(l.id)
                          const uncovered = findings.uncovered.has(l.id)
                          const past = Date.parse(l.endsAt) <= Date.parse(now)
                          // The ordinary booked lesson needs no word; every other state says itself.
                          const plain = l.status === 'active' && statusOf(l) === STATUS_LABEL.active
                          const state = [
                            plain ? null : tx(statusOf(l)),
                            l.kind === 'makeup' ? tx(KIND_LABEL.makeup) : null,
                            !l.anonymous && l.suspendedFor === 'payment' ? tx(S.paymentHold) : null,
                            l.outsideShift ? tx(S.outsideMark) : null,
                            clash ? tx(S.clash) : null,
                            uncovered ? tx(S.needsSubstitute) : null,
                          ].filter((x): x is string => !!x)
                          return (
                            <button
                              type="button"
                              className={`sc-agenda__item ${lessonClasses(l, { miss, past, clash, uncovered }).replace('sc-lesson ', '').replace(/sc-lesson--/g, 'sc-agenda__item--')}`}
                              aria-label={lessonLabel(l, tx, locale, miss, { clash, uncovered })}
                              onClick={() => onLesson(l)}
                            >
                              <span className="sc-agenda__time">{lessonTime(l, locale)}</span>
                              <span className="sc-agenda__name">
                                {l.status === 'paused' && <Icon name="pause" size={14} />}
                                <bdi>{lessonName(l, tx)}</bdi>
                              </span>
                              <span className="sc-agenda__status">{joinList(state, locale)}</span>
                            </button>
                          )
                        })()}
                      </li>
                    ) : (
                      <li key="leave" className="sc-agenda__leave">{tx(S.onLeave)}</li>
                    ),
                  )}
                </ul>
              </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}

/** The month on a phone: one row per day with its totals across the teachers shown; a day opens it. */
export function MonthAgenda({ data, onOpenDay }: { data: CalendarSummary; onOpenDay: (day: string) => void }) {
  const tx = useScheduleText()
  const { locale, number } = useI18n()
  const totals = useMemo(() => {
    const out = new Map<string, { lessons: number; empty: number }>()
    for (const c of data.cells) {
      const t = out.get(c.day) ?? { lessons: 0, empty: 0 }
      out.set(c.day, { lessons: t.lessons + c.lessons, empty: t.empty + c.emptyMinutes })
    }
    return out
  }, [data.cells])
  return (
    <ul className="sc-agenda sc-agenda__list">
      {daysOf(data.from, data.to).map((day) => {
        const t = totals.get(day) ?? { lessons: 0, empty: 0 }
        return (
          <li key={day}>
            <button type="button" className={`sc-agenda__item sc-agenda__month${t.empty > 0 ? ' sc-agenda__month--empty' : ''}`} onClick={() => onOpenDay(day)}>
              <span className="sc-agenda__name">{dayLabel(day, locale, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <span className="sc-agenda__status">
                {tx(S.dayTotals, { lessons: number(t.lessons), empty: tx(S.hours, { h: hoursOf(t.empty, locale) }) })}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
