import { useMemo, type CSSProperties } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { CalendarLesson, CalendarSummary, CalendarWindow } from './api'
import { S, WEEKDAYS, dayLabel, hoursOf, joinList, lessonsCount, percentOf, useScheduleText, type Pair } from './copy'
import { ISSUE_ORDER, dayOfLesson, minutesBetween, minutesOf, type Findings, type IssueKind } from './issues'
import { TeacherHead, lessonsByTeacherDay } from './Timeline'
import { daysOf, isoWeekday } from './viewState'

/**
 * The week and the month as boards: teachers down, days across (with the page:
 * right to left in Arabic). A week cell is one teacher's day as load against
 * working hours ("6 of 8 h") with a weak bar, and a mark only where something
 * needs a person; a day nobody works folds to a narrow column; today's column
 * carries the gold mark. A cell opens that teacher's day. The month is the
 * same language at a glance: a heat of how full each day is.
 */

export const MARK: Record<IssueKind, Pair> = {
  conflict: S.markConflict,
  absent: S.markAbsent,
  payment: S.markPayment,
  outside: S.markOutside,
}

function DayHead({ day, today, narrow, onOpen }: { day: string; today: string; narrow: boolean; onOpen: () => void }) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const w = WEEKDAYS.find((x) => x.iso === isoWeekday(day))!
  const isToday = day === today
  return (
    <div role="columnheader" className={`sc-dayhead${isToday ? ' sc-dayhead--today' : ''}${narrow ? ' sc-dayhead--narrow' : ''}`}>
      <button
        type="button"
        className="sc-dayhead__button"
        aria-label={`${tx(S.openDay, { teacher: tx(S.allTeachers), day: dayLabel(day, locale, { weekday: 'long', day: 'numeric', month: 'long' }) })}${isToday ? `, ${tx(S.todayMark)}` : ''}`}
        onClick={onOpen}
      >
        <span className="sc-dayhead__name">{tx(narrow ? w.short : w.label)}</span>
        <span className="sc-dayhead__n">{Number(day.slice(8))}</span>
      </button>
    </div>
  )
}

export function WeekBoard({
  data,
  findings,
  today,
  highlightTeacher,
  onOpenDay,
}: {
  data: CalendarWindow
  findings: Findings
  today: string
  highlightTeacher: string | null
  onOpenDay: (day: string, teacherId?: string) => void
}) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const week = daysOf(data.from, data.to)
  const intervals = useMemo(() => new Map(data.days.map((d) => [`${d.teacherId}|${d.day}`, d])), [data.days])
  const lessons = useMemo(() => lessonsByTeacherDay(data.lessons), [data.lessons])
  // A day nobody works (the academy's Friday) folds to a narrow column.
  const working = useMemo(
    () => week.map((d) => data.days.some((x) => x.day === d && x.shift.length + x.work.length > 0) || data.lessons.some((l) => dayOfLesson(l) === d)),
    [week, data.days, data.lessons],
  )
  const columns = { '--sc-cols': working.map((w) => (w ? 'minmax(92px, 1fr)' : '56px')).join(' ') } as CSSProperties
  const h = (m: number) => hoursOf(m, locale)

  return (
    <div className="sc-grid sc-grid--week" role="table" aria-label={tx(S.title)} style={columns}>
      <div className="sc-row sc-row--axis" role="row">
        <div className="sc-row__head" role="columnheader">{tx(S.teacher)}</div>
        {week.map((d, i) => (
          <DayHead key={d} day={d} today={today} narrow={!working[i]} onOpen={() => onOpenDay(d)} />
        ))}
      </div>
      {data.teachers.map((t, row) => (
        <div key={t.id} className={`sc-row${highlightTeacher === t.id ? ' is-hl' : ''}`} role="row" aria-label={t.name} data-teacher={t.id}>
          <TeacherHead t={t} />
          {week.map((d, i) => {
            const k = `${t.id}|${d}`
            const iv = intervals.get(k)
            const mine: CalendarLesson[] = lessons.get(k) ?? []
            const work = minutesOf(iv?.shift) + minutesOf(iv?.work)
            const leave = minutesOf(iv?.leave)
            const base = Math.max(0, work - leave)
            // Booked: time reserved for a student, whatever happened later (PD-38); moved and paused lessons hold none.
            const booked = mine.filter((l) => l.status !== 'moved' && l.status !== 'paused').reduce((n, l) => n + minutesBetween(l.startsAt, l.endsAt), 0)
            const marks = findings.byCell.get(k)
            const mark = ISSUE_ORDER.find((kind) => marks?.has(kind))
            const fullLeave = leave > 0 && leave >= work
            if (work === 0 && mine.length === 0) {
              return <div key={d} role="cell" className={`sc-cell sc-cell--off${!working[i] ? ' sc-cell--narrow' : ''}`} />
            }
            const day = dayLabel(d, locale, { weekday: 'long', day: 'numeric', month: 'long' })
            const facts = joinList(
              [
                base > 0 ? `${h(booked)} ${tx(S.ofHours, { base: h(base) })}` : tx(S.hours, { h: h(booked) }),
                lessonsCount(mine.length, locale),
                ...ISSUE_ORDER.filter((kind) => marks?.has(kind)).map((kind) => tx(MARK[kind])),
              ],
              locale,
            )
            const load = base > 0 ? Math.min(1, booked / base) : 0
            return (
              <div key={d} role="cell" className="sc-cellwrap">
                <button
                  type="button"
                  className={`sc-cell${fullLeave ? ' sc-cell--leave' : ''}${d === today ? ' sc-cell--today' : ''}`}
                  aria-label={`${tx(S.openDay, { teacher: t.name, day })}: ${facts}`}
                  title={facts}
                  data-nav=""
                  data-row={row}
                  onClick={() => onOpenDay(d, t.id)}
                >
                  <span className="sc-cell__figure">
                    <span className="sc-cell__n">{h(booked)}</span>
                    <span className="sc-cell__of">{base > 0 ? tx(S.ofHours, { base: h(base) }) : tx(S.hours, { h: '' }).trim()}</span>
                  </span>
                  <span className="sc-cell__foot">
                    <span className="sc-cell__bar" aria-hidden="true">
                      {base > 0 && <span style={{ inlineSize: `${load * 100}%` }} />}
                    </span>
                    {mark && <span className={`sc-mark sc-mark--${mark}`}>{tx(MARK[mark])}</span>}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Shift used (shift teachers) or booked hours against working hours (hourly) as a five-step heat. */
function heat(cell: { utilization: number | null; shiftMinutes: number; bookedMinutes: number; workMinutes: number }): number {
  if (cell.shiftMinutes > 0 && cell.utilization !== null) return Math.min(4, Math.floor(cell.utilization * 5))
  const base = cell.workMinutes || 480
  return cell.bookedMinutes === 0 ? 0 : Math.min(4, Math.floor((cell.bookedMinutes / base) * 5))
}

export function MonthView({ data, today, onOpenDay }: { data: CalendarSummary; today: string; onOpenDay: (day: string, teacherId: string) => void }) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const month = daysOf(data.from, data.to)
  const cells = useMemo(() => new Map(data.cells.map((c) => [`${c.teacherId}|${c.day}`, c])), [data.cells])
  const working = useMemo(
    () => month.map((d) => data.cells.some((c) => c.day === d && (c.shiftMinutes > 0 || c.workMinutes > 0 || c.lessons > 0))),
    [month, data.cells],
  )
  const columns = { '--sc-cols': working.map((w) => (w ? 'minmax(30px, 1fr)' : '14px')).join(' ') } as CSSProperties
  return (
    <div className="sc-grid sc-grid--month" role="table" aria-label={tx(S.title)} style={columns}>
      <div className="sc-row sc-row--axis" role="row">
        <div className="sc-row__head" role="columnheader">{tx(S.teacher)}</div>
        {month.map((d, i) => (
          <div
            key={d}
            role="columnheader"
            className={`sc-dayhead sc-dayhead--month${d === today ? ' sc-dayhead--today' : ''}${working[i] ? '' : ' sc-dayhead--off'}`}
            title={dayLabel(d, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
          >
            {working[i] && <span className="sc-dayhead__n">{Number(d.slice(8))}</span>}
          </div>
        ))}
      </div>
      {data.teachers.map((t, row) => (
        <div key={t.id} className="sc-row" role="row" aria-label={t.name}>
          <TeacherHead t={t} />
          {month.map((d, i) => {
            const c = cells.get(`${t.id}|${d}`)
            if (!c || (!working[i] && c.lessons === 0)) return <div key={d} role="cell" className={`sc-heat sc-heat--none${working[i] ? '' : ' sc-heat--narrow'}`} />
            const shift = c.shiftMinutes > 0
            const day = dayLabel(d, locale, { weekday: 'long', day: 'numeric', month: 'long' })
            const figure = shift ? percentOf(c.utilization, locale) : c.lessons > 0 ? String(c.lessons) : ''
            const summary = joinList([
              day,
              shift ? `${tx(S.utilization)} ${percentOf(c.utilization, locale)}` : null,
              c.emptyMinutes > 0 ? `${tx(S.emptyHours)} ${tx(S.hours, { h: hoursOf(c.emptyMinutes, locale) })}` : null,
              c.leaveMinutes > 0 ? tx(S.leaveHours) : null,
              c.outsideMinutes > 0 ? tx(S.outsideShift) : null,
              lessonsCount(c.lessons, locale),
            ].filter((x): x is string => !!x), locale)
            const off = c.shiftMinutes === 0 && c.workMinutes === 0 && c.lessons === 0
            const cls = [
              'sc-heat',
              `sc-heat--${off ? 'off' : heat(c)}`,
              c.inShiftLeaveMinutes > 0 && c.inShiftLeaveMinutes >= c.shiftMinutes ? 'sc-heat--leave' : '',
              c.emptyMinutes > 0 ? 'sc-heat--has-empty' : '',
              c.outsideMinutes > 0 ? 'sc-heat--outside' : '',
              data.lessonFilter && c.matching > 0 ? 'sc-heat--match' : '',
              d === today ? 'sc-heat--today' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <div key={d} role="cell">
                <button
                  type="button"
                  className={cls}
                  title={summary}
                  aria-label={`${tx(S.openDay, { teacher: t.name, day })}: ${summary}`}
                  data-nav=""
                  data-row={row}
                  onClick={() => onOpenDay(d, t.id)}
                >
                  {figure}
                </button>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
