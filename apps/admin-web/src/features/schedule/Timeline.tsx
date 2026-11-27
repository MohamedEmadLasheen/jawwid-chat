import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ACADEMY_ZONE, clock12In, hour12Label } from '@/core/time/academyTime'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import type { CalendarDay, CalendarLesson, CalendarTeacher, CalendarWindow, Interval } from './api'
import { CATEGORY_LABEL, KIND_LABEL, S, hoursOf, joinList, notTaught, percentOf, statusOf, useScheduleText } from './copy'
import { dayOfLesson, laneMap, type Findings } from './issues'
import { swatchClass } from './palette'
import { minuteOfDay } from './viewState'

/**
 * The day: a resource timeline. Teachers are rows, hours run across with the
 * page (right to left in Arabic: positions use inset-inline-start, so dir="rtl"
 * mirrors the axis with no override). Custom CSS grid on the academy's clock, no
 * calendar library.
 *
 * A lane is the teacher's day: their working hours a faint teal band, leave
 * hatched, and the rest plain. A lesson says its state by shape, never by hue
 * alone (the hue is the supervisor's, PD-38):
 *   booked        a tint with an edge at its start
 *   trial         a dashed edge all round
 *   make-up       a small mark after the name
 *   paused        muted, with a pause mark
 *   moved away / called off   muted, its time struck through
 *   payment hold  an urgent edge
 *   over          greyed text
 *   outside working hours   an amber dot
 *   clash         two lessons in half-height lanes, each with an urgent outline
 *   needs a substitute (teacher on leave)   a ghost: dashed urgent outline
 * The now line is gold, on today only.
 *
 * Every time is on the 12-hour clock (clock12In / hour12Label). Each hour has a
 * minimum width (DAY_HOUR_PX), so a long day scrolls instead of squeezing its
 * labels together; the axis runs from the earliest working hour to the latest
 * end plus half an hour, so it never clips.
 */

/** The narrowest an hour may be: a half-hour lesson keeps room for its name and its start. */
export const DAY_HOUR_PX = 96

/** The hours shown: the earliest working hour (or lesson) to the latest end plus 30 minutes. */
export function hourRange(days: CalendarDay[], lessons: CalendarLesson[]): { lo: number; hi: number } {
  let lo = Infinity
  let hi = -Infinity
  const see = (from: string, to: string, day: string) => {
    lo = Math.min(lo, minuteOfDay(from, day))
    hi = Math.max(hi, minuteOfDay(to, day))
  }
  for (const d of days) for (const [a, b] of [...d.shift, ...d.work]) see(a, b, d.day)
  for (const l of lessons) see(l.startsAt, l.endsAt, dayOfLesson(l))
  // Nothing to place: the academy's usual afternoon and evening.
  if (!Number.isFinite(lo)) return { lo: 12 * 60, hi: 21 * 60 }
  return { lo: Math.floor(lo / 60) * 60, hi: Math.min(1440, Math.ceil((hi + 30) / 30) * 30) }
}

function place(from: string, to: string, day: string, lo: number, hi: number): CSSProperties | null {
  const a = Math.max(lo, minuteOfDay(from, day))
  const b = Math.min(hi, minuteOfDay(to, day))
  if (b <= a) return null
  const span = hi - lo
  return { insetInlineStart: `${((a - lo) / span) * 100}%`, inlineSize: `${((b - a) / span) * 100}%` }
}

type Tx = ReturnType<typeof useScheduleText>

export function lessonName(l: CalendarLesson, tx: Tx): string {
  if (l.anonymous) return tx(S.booked)
  return l.learner?.name ?? l.prospect?.name ?? tx(S.booked)
}

/** The name a narrow block has room for: the first name ("Abd al-", "Abu" keep the word after them). */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name
  const joined = /^(عبد|عبدال|أبو|ابو|abd|abu|el|al)$/i.test(parts[0]!) ? 2 : 1
  return parts.slice(0, joined).join(' ')
}

/** "5:30": a start for a narrow block, the hour and minutes only (the axis says morning or evening). */
export function clockShort(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: ACADEMY_ZONE, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(iso))
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${pick('hour')}:${pick('minute')}`
}

/** "1:00 PM – 2:00 PM", on the academy's clock. */
export function lessonTime(l: { startsAt: string; endsAt: string }, locale: 'ar' | 'en'): string {
  return `${clock12In(l.startsAt, ACADEMY_ZONE, locale)} – ${clock12In(l.endsAt, ACADEMY_ZONE, locale)}`
}

/** What a lesson block says to a screen reader and in its tooltip: who, when, its state. */
export function lessonLabel(
  l: CalendarLesson,
  tx: Tx,
  locale: 'ar' | 'en',
  miss = false,
  flags: { clash?: boolean; uncovered?: boolean } = {},
): string {
  const parts = [lessonName(l, tx), lessonTime(l, locale), tx(statusOf(l))]
  if (l.kind === 'makeup') parts.push(tx(KIND_LABEL.makeup))
  if (!l.anonymous && l.suspendedFor === 'payment') parts.push(tx(S.paymentHold))
  if (l.outsideShift) parts.push(tx(S.outsideMark))
  if (flags.clash) parts.push(tx(S.clash))
  if (flags.uncovered) parts.push(tx(S.needsSubstitute))
  if (miss) parts.push(tx(S.otherBooking))
  return joinList(parts, locale)
}

/** The classes that draw a lesson's state as a shape. */
export function lessonClasses(l: CalendarLesson, o: { miss: boolean; past: boolean; clash: boolean; uncovered: boolean }): string {
  return [
    'sc-lesson',
    o.miss ? 'sc-c-none sc-lesson--other' : swatchClass(l.colorKey),
    `sc-lesson--${l.status}`,
    l.kind === 'makeup' ? 'sc-lesson--makeup' : '',
    notTaught(l) ? 'sc-lesson--not-taught' : '',
    l.outsideShift ? 'sc-lesson--outside' : '',
    !l.anonymous && l.suspendedFor === 'payment' ? 'sc-lesson--held' : '',
    o.past ? 'sc-lesson--past' : '',
    o.clash ? 'sc-lesson--clash' : '',
    o.uncovered ? 'sc-lesson--ghost' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/** One teacher's day: the working-hours band, leave, the server's empty stretches, lessons, and now. */
export function Track({
  day,
  intervals,
  lessons,
  lo,
  hi,
  lessonFilter,
  findings,
  highlight,
  now,
  showNow,
  row,
  onLesson,
}: {
  day: string
  intervals: CalendarDay | undefined
  lessons: CalendarLesson[]
  lo: number
  hi: number
  lessonFilter: boolean
  findings: Findings
  highlight: ReadonlySet<string>
  /** The instant now: what ended before it is drawn as over. */
  now: string
  /** Draw the now line (today's lane only). */
  showNow: boolean
  /** The row's index, for moving between blocks with the arrow keys. */
  row: number
  onLesson: (l: CalendarLesson) => void
}) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const laneOf = useMemo(() => laneMap(lessons), [lessons])
  const band = (list: Interval[] | undefined, cls: string) =>
    (list ?? []).map(([a, b]) => {
      const style = place(a, b, day, lo, hi)
      return style ? <span key={`${cls}-${a}`} className={cls} style={style} aria-hidden="true" /> : null
    })
  const nowAt = showNow ? minuteOfDay(now, day) : null
  const nowMs = Date.parse(now)

  return (
    <div className="sc-track">
      {band(intervals?.shift, 'sc-band sc-band--shift')}
      {band(intervals?.work, 'sc-band sc-band--work')}
      {band(intervals?.leave, 'sc-band sc-band--leave')}
      {/* The server's empty stretches: the lane's plain band, named for a pointer. */}
      {band(intervals?.empty, 'sc-empty')}
      {lessons.map((l) => {
        const style = place(l.startsAt, l.endsAt, day, lo, hi)
        if (!style) return null
        const lane = laneOf.get(l.id) ?? { lane: 0, of: 1 }
        const miss = lessonFilter && !l.matches
        const clash = findings.clashing.has(l.id)
        const uncovered = findings.uncovered.has(l.id)
        const past = Date.parse(l.endsAt) <= nowMs
        const label = lessonLabel(l, tx, locale, miss, { clash, uncovered })
        const box: CSSProperties = { ...style, insetBlockStart: `calc(${(lane.lane / lane.of) * 100}% + 4px)`, blockSize: `calc(${100 / lane.of}% - 8px)` }
        const cls = `${lessonClasses(l, { miss, past, clash, uncovered })}${lane.of > 1 ? ' sc-lesson--half' : ''}${l.anonymous ? ' sc-lesson--anon' : ''}${highlight.has(l.id) ? ' is-hl' : ''}`
        return (
          <button
            key={l.id}
            type="button"
            className={cls}
            style={box}
            title={label}
            aria-label={label}
            data-nav=""
            data-row={row}
            data-lesson={l.id}
            onClick={() => onLesson(l)}
          >
            {/* Another supervisor's child: time and colour only, never a name. */}
            {!l.anonymous && (
              <span className="sc-lesson__name">
                {l.status === 'paused' && <Icon name="pause" size={13} />}
                <bdi className="sc-lesson__full">{lessonName(l, tx)}</bdi>
                <bdi className="sc-lesson__short" aria-hidden="true">{shortName(lessonName(l, tx))}</bdi>
                {l.kind === 'makeup' && <span className="sc-lesson__mark"><Icon name="history" size={13} /></span>}
              </span>
            )}
            <span className="sc-lesson__time sc-lesson__time--range">{lessonTime(l, locale)}</span>
            <span className="sc-lesson__time sc-lesson__time--start" aria-hidden="true">{clockShort(l.startsAt)}</span>
          </button>
        )
      })}
      {nowAt !== null && nowAt > lo && nowAt < hi && (
        <span className="sc-now" style={{ insetInlineStart: `${((nowAt - lo) / (hi - lo)) * 100}%` }} aria-hidden="true" />
      )}
    </div>
  )
}

export function TeacherHead({ t, absent, onLeave }: { t: CalendarTeacher; absent?: boolean; onLeave?: boolean }) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const shift = t.category === 'full_shift' || t.category === 'part_shift'
  return (
    <div className="sc-row__head" role="rowheader">
      <span className="sc-row__name" dir="auto">{t.name}</span>
      <span className="sc-row__sub">
        {absent || onLeave ? <Badge tone="neutral">{tx(S.onLeave)}</Badge> : tx(CATEGORY_LABEL[t.category])}
      </span>
      <span className="sc-row__figure" title={shift ? tx(S.utilization) : tx(S.colBooked)}>
        {shift ? percentOf(t.utilization, locale) : tx(S.hours, { h: hoursOf(t.totals.bookedMinutes, locale) })}
      </span>
    </div>
  )
}

function HourAxis({ lo, hi, now, nowMin }: { lo: number; hi: number; now: string; nowMin: number | null }) {
  const { locale } = useI18n()
  const tx = useScheduleText()
  const hours: number[] = []
  for (let m = lo; m < hi; m += 60) hours.push(m)
  const at = (m: number) => `${((m - lo) / (hi - lo)) * 100}%`
  return (
    <div className="sc-axis">
      {hours.map((m) => (
        <span key={m} className="sc-axis__tick" style={{ insetInlineStart: at(m) }} aria-hidden="true">
          <bdi>{hour12Label(m / 60, locale)}</bdi>
        </span>
      ))}
      {nowMin !== null && (
        <span className="sc-now-label" style={{ insetInlineStart: at(nowMin) }}>
          <span className="sr-only">{tx(S.nowLine)} </span>
          <bdi>{clock12In(now, ACADEMY_ZONE, locale)}</bdi>
        </span>
      )}
    </div>
  )
}

function byTeacherDay(days: CalendarDay[]): Map<string, CalendarDay> {
  return new Map(days.map((d) => [`${d.teacherId}|${d.day}`, d]))
}

export function lessonsByTeacherDay(lessons: CalendarLesson[]): Map<string, CalendarLesson[]> {
  const out = new Map<string, CalendarLesson[]>()
  for (const l of lessons) {
    const k = `${l.teacherId}|${dayOfLesson(l)}`
    const list = out.get(k)
    if (list) list.push(l)
    else out.set(k, [l])
  }
  return out
}

export function DayView({
  data,
  day,
  findings,
  highlight,
  highlightTeacher,
  now,
  isToday,
  onLesson,
}: {
  data: CalendarWindow
  day: string
  findings: Findings
  highlight: ReadonlySet<string>
  highlightTeacher: string | null
  /** The instant now. */
  now: string
  /** The day shown is today: the now line is drawn. */
  isToday: boolean
  onLesson: (l: CalendarLesson) => void
}) {
  const tx = useScheduleText()
  const { lo, hi } = useMemo(() => hourRange(data.days, data.lessons), [data])
  const days = useMemo(() => byTeacherDay(data.days), [data.days])
  const lessons = useMemo(() => lessonsByTeacherDay(data.lessons), [data.lessons])
  const nowIn = isToday ? minuteOfDay(now, day) : null
  const nowMin = nowIn !== null && nowIn > lo && nowIn < hi ? nowIn : null
  // A minimum width per hour: a long day scrolls instead of squeezing its labels together.
  const width = { '--sc-day-w': `${((hi - lo) / 60) * DAY_HOUR_PX}px`, '--sc-hour': `${(60 / (hi - lo)) * 100}%` } as CSSProperties

  // Open on the part of the day that matters: now on today, else the first lesson.
  const anchor = useRef<HTMLSpanElement>(null)
  const first = useMemo(() => data.lessons.reduce<string | null>((m, l) => (m === null || l.startsAt < m ? l.startsAt : m), null), [data.lessons])
  const anchorMin = nowMin !== null ? Math.max(lo, nowMin - 60) : first ? Math.max(lo, minuteOfDay(first, day) - 30) : lo
  useLayoutEffect(() => {
    const el = anchor.current
    const scroller = el?.closest<HTMLElement>('.sc-scroll')
    if (!el || !scroller || typeof scroller.scrollBy !== 'function') return
    const head = scroller.querySelector<HTMLElement>('.sc-row__head')
    const a = el.getBoundingClientRect()
    const s = scroller.getBoundingClientRect()
    const rtl = getComputedStyle(scroller).direction === 'rtl'
    const headW = head?.getBoundingClientRect().width ?? 0
    // Bring the anchor to just past the sticky teacher column.
    const delta = rtl ? -(s.right - headW - a.right) : a.left - (s.left + headW)
    scroller.scrollBy({ left: delta })
    // Only when the day changes: a re-read keeps where the person scrolled to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, lo, hi])

  return (
    <div className={`sc-grid sc-grid--day${highlight.size > 0 ? ' has-hl' : ''}`} role="table" aria-label={tx(S.title)} style={width} data-hours={(hi - lo) / 60}>
      <div className="sc-row sc-row--axis" role="row">
        <div className="sc-row__head" role="columnheader">
          <span>{tx(S.teacher)}</span>
          <span className="sc-row__head-end">{tx(S.colUsed)}</span>
        </div>
        <div role="columnheader" className="sc-axis-cell">
          <HourAxis lo={lo} hi={hi} now={now} nowMin={nowMin} />
          <span ref={anchor} className="sc-anchor" style={{ insetInlineStart: `${((anchorMin - lo) / (hi - lo)) * 100}%` }} aria-hidden="true" />
        </div>
      </div>
      {data.teachers.map((t, i) => {
        const k = `${t.id}|${day}`
        const absent = findings.absent.has(k)
        const onLeave = (days.get(k)?.leave.length ?? 0) > 0
        return (
          <div
            key={t.id}
            className={`sc-row${absent ? ' sc-row--absent' : ''}${highlightTeacher === t.id ? ' is-hl' : ''}`}
            role="row"
            aria-label={t.name}
            data-teacher={t.id}
          >
            <TeacherHead t={t} absent={absent} onLeave={onLeave} />
            <div role="cell" className="sc-lane">
              <Track
                day={day}
                intervals={days.get(k)}
                lessons={lessons.get(k) ?? []}
                lo={lo}
                hi={hi}
                lessonFilter={data.lessonFilter}
                findings={findings}
                highlight={highlight}
                now={now}
                showNow={nowMin !== null}
                row={i}
                onLesson={onLesson}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
