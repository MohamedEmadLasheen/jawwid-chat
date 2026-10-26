import { useMemo, type CSSProperties } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ACADEMY_ZONE, clockIn, isoToAcademyWallClock } from '@/core/time/academyTime'
import type { CalendarDay, CalendarLesson, CalendarSummary, CalendarTeacher, CalendarWindow, Interval } from './api'
import { CATEGORY_LABEL, S, STATUS_LABEL, WEEKDAYS, dayLabel, hoursOf, percentOf, useScheduleText } from './copy'
import { swatchClass } from './palette'
import { daysOf, isoWeekday, minuteOfDay } from './viewState'

/**
 * PD-38 grids. Custom CSS grid on the academy's clock (no calendar library:
 * the academy view is teachers x time, and the layers -- shift band, red empty
 * time, grey out-of-shift, hatched leave, supervisor fill with solid / dashed /
 * dotted borders -- are ours). Positions use inset-inline-start, so under
 * dir="rtl" the time axis runs right to left with no override.
 *
 * Rows use `content-visibility: auto` (schedule.css): a hundred teachers cost
 * only the rows on screen.
 */

/** The hours shown: everything the data holds, at least 10:00-22:00. */
export function hourRange(days: CalendarDay[], lessons: CalendarLesson[]): { lo: number; hi: number } {
  let lo = 10 * 60
  let hi = 22 * 60
  const see = (from: string, to: string, day: string) => {
    lo = Math.min(lo, minuteOfDay(from, day))
    hi = Math.max(hi, minuteOfDay(to, day))
  }
  for (const d of days) for (const [a, b] of [...d.shift, ...d.work]) see(a, b, d.day)
  for (const l of lessons) see(l.startsAt, l.endsAt, dayOfLesson(l))
  return { lo: Math.floor(lo / 60) * 60, hi: Math.min(1440, Math.ceil(hi / 60) * 60) }
}

const dayCache = new Map<string, string>()
/** A lesson's academy day (memoized: thousands of lessons in a month). */
function dayOfLesson(l: CalendarLesson): string {
  let d = dayCache.get(l.startsAt)
  if (!d) {
    d = isoToAcademyWallClock(l.startsAt).date
    dayCache.set(l.startsAt, d)
  }
  return d
}

function place(from: string, to: string, day: string, lo: number, hi: number): CSSProperties | null {
  const a = Math.max(lo, minuteOfDay(from, day))
  const b = Math.min(hi, minuteOfDay(to, day))
  if (b <= a) return null
  const span = hi - lo
  return { insetInlineStart: `${((a - lo) / span) * 100}%`, inlineSize: `${((b - a) / span) * 100}%` }
}

/** Lanes for overlapping lessons in one track: overlap is drawn, never hidden. */
function lanes(lessons: CalendarLesson[]): Map<string, { lane: number; of: number }> {
  const sorted = [...lessons].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const ends: string[] = []
  const at = new Map<string, number>()
  for (const l of sorted) {
    let lane = ends.findIndex((e) => e <= l.startsAt)
    if (lane === -1) lane = ends.length
    ends[lane] = l.endsAt
    at.set(l.id, lane)
  }
  const of = Math.max(1, ends.length)
  return new Map([...at].map(([id, lane]) => [id, { lane, of }]))
}

function lessonName(l: CalendarLesson, tx: ReturnType<typeof useScheduleText>): string {
  if (l.anonymous) return tx(S.booked)
  return l.learner?.name ?? l.prospect?.name ?? tx(S.booked)
}

/** What a lesson block says to a screen reader and in its tooltip: who, when, status. */
export function lessonLabel(l: CalendarLesson, tx: ReturnType<typeof useScheduleText>, locale: 'ar' | 'en', miss = false): string {
  const parts = [lessonName(l, tx), `${clockIn(l.startsAt, ACADEMY_ZONE, locale)}–${clockIn(l.endsAt, ACADEMY_ZONE, locale)}`, tx(STATUS_LABEL[l.status])]
  if (l.outsideShift) parts.push(tx(S.outsideMark))
  if (miss) parts.push(tx(S.otherBooking))
  return parts.join(' · ')
}

/** One teacher's day: grey track, shift / working-hour bands, leave, red empty time, lessons. */
export function Track({
  day,
  intervals,
  lessons,
  lo,
  hi,
  lessonFilter,
  compact = false,
  onLesson,
}: {
  day: string
  intervals: CalendarDay | undefined
  lessons: CalendarLesson[]
  lo: number
  hi: number
  lessonFilter: boolean
  compact?: boolean
  onLesson?: (l: CalendarLesson) => void
}) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const laneOf = useMemo(() => lanes(lessons), [lessons])
  const band = (list: Interval[] | undefined, cls: string) =>
    (list ?? []).map(([a, b]) => {
      const style = place(a, b, day, lo, hi)
      return style ? <span key={`${cls}-${a}`} className={cls} style={style} aria-hidden="true" /> : null
    })

  return (
    <div className={`sc-track${compact ? ' sc-track--compact' : ''}`}>
      {band(intervals?.shift, 'sc-band sc-band--shift')}
      {band(intervals?.work, 'sc-band sc-band--work')}
      {band(intervals?.leave, 'sc-band sc-band--leave')}
      {band(intervals?.empty, 'sc-empty')}
      {lessons.map((l) => {
        const style = place(l.startsAt, l.endsAt, day, lo, hi)
        if (!style) return null
        const lane = laneOf.get(l.id) ?? { lane: 0, of: 1 }
        const miss = lessonFilter && !l.matches
        const label = lessonLabel(l, tx, locale, miss)
        const cls = [
          'sc-lesson',
          miss ? 'sc-c-none sc-lesson--other' : swatchClass(l.colorKey),
          `sc-lesson--${l.status}`,
          l.outsideShift ? 'sc-lesson--outside' : '',
        ].join(' ')
        const box: CSSProperties = { ...style, insetBlockStart: `${(lane.lane / lane.of) * 100}%`, blockSize: `${100 / lane.of}%` }
        return (
          <button key={l.id} type="button" className={cls} style={box} title={label} aria-label={label} onClick={() => onLesson?.(l)}>
            {!compact && <span className="sc-lesson__name" dir="auto">{lessonName(l, tx)}</span>}
          </button>
        )
      })}
    </div>
  )
}

function TeacherHead({ t }: { t: CalendarTeacher }) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const shift = t.category === 'full_shift' || t.category === 'part_shift'
  return (
    <div className="sc-row__head">
      <span className="sc-row__name" dir="auto">{t.name}</span>
      <span className={`sc-cat sc-cat--${t.category}`}>{tx(CATEGORY_LABEL[t.category])}</span>
      <span className="sc-row__figure">
        {shift ? percentOf(t.utilization, locale) : tx(S.hours, { h: hoursOf(t.totals.bookedMinutes, locale) })}
      </span>
    </div>
  )
}

function HourAxis({ lo, hi }: { lo: number; hi: number }) {
  const hours: number[] = []
  for (let m = lo; m < hi; m += 60) hours.push(m)
  return (
    <div className="sc-axis" aria-hidden="true">
      {hours.map((m) => (
        <span key={m} className="sc-axis__tick" style={{ insetInlineStart: `${((m - lo) / (hi - lo)) * 100}%` }}>
          <bdi dir="ltr">{String(m / 60).padStart(2, '0')}:00</bdi>
        </span>
      ))}
    </div>
  )
}

function byTeacherDay(days: CalendarDay[]): Map<string, CalendarDay> {
  return new Map(days.map((d) => [`${d.teacherId}|${d.day}`, d]))
}

function lessonsByTeacherDay(lessons: CalendarLesson[]): Map<string, CalendarLesson[]> {
  const out = new Map<string, CalendarLesson[]>()
  for (const l of lessons) {
    const k = `${l.teacherId}|${dayOfLesson(l)}`
    out.set(k, [...(out.get(k) ?? []), l])
  }
  return out
}

export function DayView({ data, day, onLesson }: { data: CalendarWindow; day: string; onLesson: (l: CalendarLesson) => void }) {
  const tx = useScheduleText()
  const { lo, hi } = useMemo(() => hourRange(data.days, data.lessons), [data])
  const days = useMemo(() => byTeacherDay(data.days), [data.days])
  const lessons = useMemo(() => lessonsByTeacherDay(data.lessons), [data.lessons])
  return (
    <div className="sc-grid sc-grid--day" role="table" aria-label={tx(S.title)}>
      <div className="sc-row sc-row--axis" role="row">
        <div className="sc-row__head" role="columnheader">{tx(S.teacher)}</div>
        <div role="columnheader"><HourAxis lo={lo} hi={hi} /></div>
      </div>
      {data.teachers.map((t) => (
        <div key={t.id} className="sc-row" role="row" aria-label={t.name}>
          <TeacherHead t={t} />
          <div role="cell">
            <Track
              day={day}
              intervals={days.get(`${t.id}|${day}`)}
              lessons={lessons.get(`${t.id}|${day}`) ?? []}
              lo={lo}
              hi={hi}
              lessonFilter={data.lessonFilter}
              onLesson={onLesson}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export function WeekView({
  data,
  onLesson,
  onOpenDay,
}: {
  data: CalendarWindow
  onLesson: (l: CalendarLesson) => void
  onOpenDay: (day: string) => void
}) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const { lo, hi } = useMemo(() => hourRange(data.days, data.lessons), [data])
  const days = useMemo(() => byTeacherDay(data.days), [data.days])
  const lessons = useMemo(() => lessonsByTeacherDay(data.lessons), [data.lessons])
  const week = daysOf(data.from, data.to)
  return (
    <div className="sc-grid sc-grid--week" role="table" aria-label={tx(S.title)}>
      <div className="sc-row sc-row--axis" role="row">
        <div className="sc-row__head" role="columnheader">{tx(S.teacher)}</div>
        {week.map((d) => (
          <div key={d} role="columnheader" className="sc-dayhead">
            <button type="button" className="sc-link" onClick={() => onOpenDay(d)}>
              {tx(WEEKDAYS.find((w) => w.iso === isoWeekday(d))!.short)} {dayLabel(d, locale, { day: 'numeric', month: 'short' })}
            </button>
          </div>
        ))}
      </div>
      {data.teachers.map((t) => (
        <div key={t.id} className="sc-row" role="row" aria-label={t.name}>
          <TeacherHead t={t} />
          {week.map((d) => {
            const cell = days.get(`${t.id}|${d}`)
            const mine = lessons.get(`${t.id}|${d}`) ?? []
            const empty = (cell?.empty ?? []).reduce((n, [a, b]) => n + (Date.parse(b) - Date.parse(a)) / 60_000, 0)
            return (
              <div key={d} role="cell" className="sc-weekcell">
                <Track day={d} intervals={cell} lessons={mine} lo={lo} hi={hi} lessonFilter={data.lessonFilter} compact onLesson={onLesson} />
                <span className="sc-weekcell__note">
                  {mine.length > 0 && <span>{mine.length}</span>}
                  {empty > 0 && <span className="sc-weekcell__empty">{tx(S.hours, { h: hoursOf(empty, locale) })}</span>}
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Utilization (shift teachers) or booked hours (hourly) as a five-step heat. */
function heat(cell: { utilization: number | null; shiftMinutes: number; bookedMinutes: number; workMinutes: number }): number {
  if (cell.shiftMinutes > 0 && cell.utilization !== null) return Math.min(4, Math.floor(cell.utilization * 5))
  const base = cell.workMinutes || 480
  return cell.bookedMinutes === 0 ? 0 : Math.min(4, Math.floor((cell.bookedMinutes / base) * 5))
}

export function MonthView({ data, onOpenDay }: { data: CalendarSummary; onOpenDay: (day: string, teacherId: string) => void }) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const month = daysOf(data.from, data.to)
  const cells = useMemo(() => new Map(data.cells.map((c) => [`${c.teacherId}|${c.day}`, c])), [data.cells])
  return (
    <>
      <p className="sc-hint">{tx(S.monthHint)}</p>
      <div className="sc-grid sc-grid--month" role="table" aria-label={tx(S.title)} style={{ '--sc-days': month.length } as CSSProperties}>
        <div className="sc-row sc-row--axis" role="row">
          <div className="sc-row__head" role="columnheader">{tx(S.teacher)}</div>
          {month.map((d) => (
            <div key={d} role="columnheader" className={`sc-dayhead sc-dayhead--narrow${isoWeekday(d) === 5 ? ' sc-dayhead--off' : ''}`}>
              <span>{Number(d.slice(8))}</span>
            </div>
          ))}
        </div>
        {data.teachers.map((t) => (
          <div key={t.id} className="sc-row" role="row" aria-label={t.name}>
            <TeacherHead t={t} />
            {month.map((d) => {
              const c = cells.get(`${t.id}|${d}`)
              if (!c) return <div key={d} role="cell" className="sc-heat sc-heat--none" />
              const shift = c.shiftMinutes > 0
              const day = dayLabel(d, locale, { weekday: 'long', day: 'numeric', month: 'long' })
              const figure = shift ? percentOf(c.utilization, locale) : c.lessons > 0 ? String(c.lessons) : ''
              const summary = [
                day,
                shift ? `${tx(S.utilization)} ${percentOf(c.utilization, locale)}` : null,
                c.emptyMinutes > 0 ? `${tx(S.emptyHours)} ${tx(S.hours, { h: hoursOf(c.emptyMinutes, locale) })}` : null,
                c.leaveMinutes > 0 ? tx(S.leaveHours) : null,
                `${c.lessons}`,
              ].filter(Boolean).join(' · ')
              return (
                <div key={d} role="cell">
                  <button
                    type="button"
                    className={`sc-heat sc-heat--${c.shiftMinutes === 0 && c.workMinutes === 0 && c.lessons === 0 ? 'off' : heat(c)}${c.inShiftLeaveMinutes > 0 && c.inShiftLeaveMinutes >= c.shiftMinutes ? ' sc-heat--leave' : ''}${c.emptyMinutes > 0 ? ' sc-heat--has-empty' : ''}${data.lessonFilter && c.matching > 0 ? ' sc-heat--match' : ''}`}
                    title={summary}
                    aria-label={`${tx(S.openDay, { teacher: t.name, day })}: ${summary}`}
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
    </>
  )
}
