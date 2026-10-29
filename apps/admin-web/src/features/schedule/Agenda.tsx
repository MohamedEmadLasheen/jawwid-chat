import { useMemo } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ACADEMY_ZONE, clock12In, isoToAcademyWallClock } from '@/core/time/academyTime'
import type { CalendarDay, CalendarLesson, CalendarSummary, CalendarWindow } from './api'
import { CATEGORY_LABEL, S, STATUS_LABEL, dayLabel, hoursOf, useScheduleText } from './copy'
import { swatchClass } from './palette'
import { lessonLabel, lessonTime } from './Timeline'
import { daysOf } from './viewState'

/**
 * PD-38 on a phone (owner, 2026-10-28): the same data as the grids, as a list.
 * One section per day under a date bar that stays at the top while it scrolls;
 * in it, each teacher with something that day -- their lessons and the shift
 * time no student holds, in time order, every row a full-width target of at
 * least 44 px. A lesson opens the same details as on the grid.
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

export function AgendaView({ data, onLesson }: { data: CalendarWindow; onLesson: (l: CalendarLesson) => void }) {
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
            </h3>
            {teachers.length === 0 && <p className="sc-muted sc-agenda__none">{tx(S.noLessonsDay)}</p>}
            {teachers.map(({ t, rows }) => (
              <div key={t.id} className="sc-agenda__teacher">
                <div className="sc-agenda__who">
                  <span className="sc-row__name"><bdi>{t.name}</bdi></span>
                  <span className={`sc-cat sc-cat--${t.category}`}>{tx(CATEGORY_LABEL[t.category])}</span>
                </div>
                <ul className="sc-agenda__list">
                  {rows.map((r) =>
                    r.kind === 'lesson' ? (
                      <li key={r.lesson.id}>
                        <button
                          type="button"
                          className={`sc-agenda__item sc-agenda__item--${r.lesson.status} ${data.lessonFilter && !r.lesson.matches ? 'sc-c-none' : swatchClass(r.lesson.colorKey)}`}
                          aria-label={lessonLabel(r.lesson, tx, locale, data.lessonFilter && !r.lesson.matches)}
                          onClick={() => onLesson(r.lesson)}
                        >
                          <span className="sc-agenda__time">{lessonTime(r.lesson, locale)}</span>
                          <span className="sc-agenda__name">
                            <bdi>{r.lesson.anonymous ? tx(S.booked) : r.lesson.learner?.name ?? r.lesson.prospect?.name ?? tx(S.booked)}</bdi>
                          </span>
                          <span className="sc-agenda__status">
                            {tx(STATUS_LABEL[r.lesson.status])}
                            {r.lesson.outsideShift && ` · ${tx(S.outsideMark)}`}
                          </span>
                        </button>
                      </li>
                    ) : r.kind === 'empty' ? (
                      <li key={`empty-${r.at}`} className="sc-agenda__empty">
                        <span className="sc-agenda__time">{`${clock12In(r.at, ACADEMY_ZONE, locale)} – ${clock12In(r.to, ACADEMY_ZONE, locale)}`}</span>
                        <span>{tx(S.availableSlot)}</span>
                      </li>
                    ) : (
                      <li key="leave" className="sc-agenda__leave">{tx(S.onLeave)}</li>
                    ),
                  )}
                </ul>
              </div>
            ))}
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
