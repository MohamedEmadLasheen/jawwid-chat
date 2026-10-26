import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import {
  ACADEMY_ZONE,
  clockIn,
  dayMonthIn,
  isoToAcademyWallClock,
  isoWeekdayIn,
  weekdayIn,
  zoneLabel,
} from '@/core/time/academyTime'
import './slot-picker.css'

/**
 * PD-31: the one time picker of Admin Web. Free times the server offered, as
 * chips: a strip of days ("Mon 27 · 6 times"), then the chosen day's times
 * under Morning / Afternoon / Evening on the academy's (Cairo) clock. One click
 * selects; the arrow keys move between chips like a radio group (and follow
 * the reading direction), Home / End jump to the ends. Only offered times can
 * be picked, so a clash cannot be chosen; the server still re-checks on save.
 *
 * `SlotPicker` takes one-off instants (a trial, a move, an added lesson).
 * `WeeklySlotPicker` takes weekly options and marks the weeks a time is not
 * free ("except 2 Nov"). Both show "Lessons paused — payment" instead of chips
 * when the server says lessons are locked (PD-30).
 */

type Pair = { en: string; ar: string }
export type DayPart = 'morning' | 'afternoon' | 'evening'
/** PD-30's `locked`: always null until PD-30 lands. */
export type LockReason = 'balance' | 'overdue' | null

export const SLOT_COPY = {
  day: { en: 'Day', ar: 'اليوم' },
  morning: { en: 'Morning', ar: 'الصباح' },
  afternoon: { en: 'Afternoon', ar: 'بعد الظهر' },
  evening: { en: 'Evening', ar: 'المساء' },
  empty: { en: 'No free times in the coming weeks.', ar: 'لا توجد أوقات متاحة في الأسابيع القادمة.' },
  loading: { en: 'Loading free times…', ar: 'جارٍ تحميل الأوقات المتاحة…' },
  locked: { en: 'Lessons paused — payment', ar: 'الحصص متوقفة — الدفع' },
  except: { en: 'except {dates}', ar: 'عدا {dates}' },
  zone: { en: 'Times shown in {zone}', ar: 'الأوقات {zone}' },
} satisfies Record<string, Pair>

const PARTS: DayPart[] = ['morning', 'afternoon', 'evening']

/** Morning before 12:00, afternoon 12:00-16:59, evening from 17:00 -- on a 24-hour "HH:MM". */
export function dayPartOf(clock24: string): DayPart {
  const h = Number(clock24.slice(0, 2))
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}

/** "6 times" / "٦ أوقات". */
function timesCount(n: number, locale: 'ar' | 'en'): string {
  if (locale === 'en') return n === 1 ? '1 time' : `${n} times`
  const num = new Intl.NumberFormat('ar-EG').format(n)
  if (n === 1) return 'وقت واحد'
  if (n === 2) return 'وقتان'
  return n <= 10 ? `${num} أوقات` : `${num} وقتًا`
}

interface ChipItem {
  key: string
  day: string
  dayLabel: string
  /** 24-hour "HH:MM" on the shown clock: grouping and order. */
  clock: string
  label: string
  note?: string
}

export function LockedNotice({ className = '' }: { className?: string }) {
  const { locale } = useI18n()
  return (
    <div className={`banner banner--warn sp-locked ${className}`.trim()} role="status">
      {locale === 'ar' ? SLOT_COPY.locked.ar : SLOT_COPY.locked.en}
    </div>
  )
}

function ChipPicker({
  items,
  value,
  onSelect,
  label,
  locked,
  loading,
  emptyText,
  zone,
}: {
  items: ChipItem[]
  value: string | null
  onSelect: (key: string) => void
  label: string
  locked?: LockReason
  loading?: boolean
  emptyText?: string
  zone: string
}) {
  const { locale, dir } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const id = useId()
  const [pickedDay, setPickedDay] = useState<string | null>(null)
  const dayRefs = useRef(new Map<string, HTMLButtonElement>())
  const timeRefs = useRef(new Map<string, HTMLButtonElement>())

  if (locked) return <LockedNotice />
  if (loading) return <p className="ts-muted sp-wait" role="status">{tx(SLOT_COPY.loading)}</p>
  if (items.length === 0) return <p className="ts-muted sp-empty">{emptyText ?? tx(SLOT_COPY.empty)}</p>

  const days: Array<{ key: string; label: string; count: number }> = []
  for (const it of items) {
    const d = days.find((x) => x.key === it.day)
    if (d) d.count += 1
    else days.push({ key: it.day, label: it.dayLabel, count: 1 })
  }
  const selected = items.find((it) => it.key === value) ?? null
  const activeDay =
    pickedDay && days.some((d) => d.key === pickedDay) ? pickedDay : selected?.day ?? days[0]!.key
  const dayItems = items.filter((it) => it.day === activeDay).sort((a, b) => a.clock.localeCompare(b.clock))
  const tabbableTime = dayItems.some((it) => it.key === value) ? value : dayItems[0]?.key

  // Radio-group keys: Down / Up always next / previous; Left / Right follow the
  // reading direction (in Arabic, Left is next). Home / End jump to the ends.
  const step = (e: KeyboardEvent, keys: string[], current: string, go: (k: string) => void) => {
    const i = keys.indexOf(current)
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
    const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
    let next: number | null = null
    if (e.key === 'ArrowDown' || e.key === forward) next = (i + 1) % keys.length
    else if (e.key === 'ArrowUp' || e.key === back) next = (i - 1 + keys.length) % keys.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = keys.length - 1
    if (next === null) return
    e.preventDefault()
    go(keys[next]!)
  }
  const goDay = (k: string) => {
    setPickedDay(k)
    dayRefs.current.get(k)?.focus()
  }
  const goTime = (k: string) => {
    onSelect(k)
    timeRefs.current.get(k)?.focus()
  }
  const timeKeys = dayItems.map((it) => it.key)

  return (
    <div className="sp" role="group" aria-label={label}>
      <div className="sp-days" role="radiogroup" aria-label={tx(SLOT_COPY.day)}>
        {days.map((d) => (
          <button
            key={d.key}
            ref={(el) => {
              if (el) dayRefs.current.set(d.key, el)
              else dayRefs.current.delete(d.key)
            }}
            type="button"
            role="radio"
            aria-checked={d.key === activeDay}
            tabIndex={d.key === activeDay ? 0 : -1}
            className={`sp-chip sp-day${selected?.day === d.key ? ' sp-day--has-choice' : ''}`}
            onClick={() => setPickedDay(d.key)}
            onKeyDown={(e) => step(e, days.map((x) => x.key), d.key, goDay)}
          >
            {d.label} · {timesCount(d.count, locale)}
          </button>
        ))}
      </div>
      {PARTS.map((part) => {
        const inPart = dayItems.filter((it) => dayPartOf(it.clock) === part)
        if (inPart.length === 0) return null
        return (
          <div className="sp-part" key={part}>
            <span className="sp-part__title" id={`${id}-${part}`}>{tx(SLOT_COPY[part])}</span>
            <div className="sp-times" role="radiogroup" aria-labelledby={`${id}-${part}`}>
              {inPart.map((it) => (
                <button
                  key={it.key}
                  ref={(el) => {
                    if (el) timeRefs.current.set(it.key, el)
                    else timeRefs.current.delete(it.key)
                  }}
                  type="button"
                  role="radio"
                  aria-checked={it.key === value}
                  tabIndex={it.key === tabbableTime ? 0 : -1}
                  className="sp-chip sp-time"
                  data-slot={it.key}
                  onClick={() => onSelect(it.key)}
                  onKeyDown={(e) => step(e, timeKeys, it.key, goTime)}
                >
                  <span dir="ltr">{it.label}</span>
                  {it.note && (
                    <>
                      {' '}
                      <span className="sp-chip__note">· {it.note}</span>
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
        )
      })}
      <p className="sp-zone">{tx(SLOT_COPY.zone).replace('{zone}', zoneLabel(zone, locale))}</p>
    </div>
  )
}

/** "Mon 27" in the zone. */
function shortDay(iso: string, zone: string, locale: 'ar' | 'en'): string {
  const n = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { timeZone: zone, day: 'numeric' }).format(new Date(iso))
  return `${weekdayIn(iso, zone, locale)} ${n}`
}

/** One-off free times (ISO instants) as day and time chips. */
export function SlotPicker({
  slots,
  value,
  onChange,
  label,
  locked = null,
  loading = false,
  emptyText,
  formatTime,
  zone = ACADEMY_ZONE,
}: {
  slots: string[]
  value: string | null
  onChange: (iso: string) => void
  /** The picker's accessible name ("Free time"). */
  label: string
  locked?: LockReason
  loading?: boolean
  emptyText?: string
  /** How a time chip reads; the academy's 24-hour clock by default. */
  formatTime?: (iso: string) => string
  zone?: string
}) {
  const { locale } = useI18n()
  const items: ChipItem[] = [...slots]
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
    .map((iso) => {
      const wall = isoToAcademyWallClock(iso, zone)
      return {
        key: iso,
        day: wall.date,
        dayLabel: shortDay(iso, zone, locale),
        clock: wall.time,
        label: formatTime ? formatTime(iso) : clockIn(iso, zone, locale),
      }
    })
  return (
    <ChipPicker
      items={items}
      value={value}
      onSelect={onChange}
      label={label}
      locked={locked}
      loading={loading}
      emptyText={emptyText}
      zone={zone}
    />
  )
}

/** A weekly time the server offers (GET /learners/:id/schedule-options). */
export interface WeeklyOption {
  weekday: number
  /** "HH:MM" in the TEACHER's zone -- sent back as is. */
  start: string
  /** The next start, shown on the reader's clock. */
  nextStartsAt: string
  /** Starts in the next 4 weeks at which the teacher already has another lesson. */
  except: string[]
}

export function weeklyKey(o: { weekday: number; start: string }): string {
  return `${o.weekday}|${o.start}`
}

/** "except 2 Nov, 9 Nov" on the reader's clock. */
export function exceptText(except: string[], zone: string, locale: 'ar' | 'en'): string {
  const dates = except.map((d) => dayMonthIn(d, zone, locale)).join(locale === 'ar' ? '، ' : ', ')
  return (locale === 'ar' ? SLOT_COPY.except.ar : SLOT_COPY.except.en).replace('{dates}', dates)
}

/** Weekly options as weekday and time chips, each marked with the weeks it is not free. */
export function WeeklySlotPicker({
  options,
  value,
  onChange,
  label,
  locked = null,
  loading = false,
  emptyText,
  zone = ACADEMY_ZONE,
}: {
  options: WeeklyOption[]
  value: { weekday: number; start: string } | null
  onChange: (option: WeeklyOption) => void
  label: string
  locked?: LockReason
  loading?: boolean
  emptyText?: string
  zone?: string
}) {
  const { locale } = useI18n()
  const items: ChipItem[] = [...options]
    .sort((a, b) => isoWeekdayIn(a.nextStartsAt, zone) - isoWeekdayIn(b.nextStartsAt, zone))
    .map((o) => {
      const day = isoWeekdayIn(o.nextStartsAt, zone)
      return {
        key: weeklyKey(o),
        day: String(day),
        dayLabel: weekdayIn(o.nextStartsAt, zone, locale),
        clock: isoToAcademyWallClock(o.nextStartsAt, zone).time,
        label: clockIn(o.nextStartsAt, zone, locale),
        ...(o.except.length ? { note: exceptText(o.except, zone, locale) } : {}),
      }
    })
  return (
    <ChipPicker
      items={items}
      value={value ? weeklyKey(value) : null}
      onSelect={(k) => {
        const o = options.find((x) => weeklyKey(x) === k)
        if (o) onChange(o)
      }}
      label={label}
      locked={locked}
      loading={loading}
      emptyText={emptyText}
      zone={zone}
    />
  )
}
