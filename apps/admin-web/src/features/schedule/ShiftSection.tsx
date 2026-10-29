import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ACADEMY_ZONE, wallClock12 } from '@/core/time/academyTime'
import { Dialog } from '@/shared/components/Dialog'
import { QueryBoundary } from '@/shared/components/States'
import type { Category, ShiftDefault, ShiftWindow, WorkPattern, WorkPatterns } from './api'
import { CATEGORY_LABEL, S, WEEKDAYS, dayLabel, describeScheduleError, useScheduleText } from './copy'
import { useCalendarOptions, useSetWorkPattern, useWorkPatterns } from './hooks'
import { academyToday } from './viewState'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import './schedule.css'

/**
 * PD-38 in the Teacher File: the teacher's category and shift, effective-dated.
 * The Teachers Manager and the super admin change it; everyone else who opens
 * the file reads it. A change starts on a day and never rewrites the days
 * before it (the server keeps each pattern; this only shows them).
 */
export function ShiftSection({ teacherId }: { teacherId: string }) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const q = useWorkPatterns(teacherId)
  const options = useCalendarOptions()
  const [editing, setEditing] = useState(false)
  const canEdit = options.data?.viewer.canEditShifts === true
  const fmt = (d: string) => dayLabel(d, locale, { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <section className="card panel tf-section" aria-labelledby="tf-shift">
      <div className="tf-section__head">
        <h2 id="tf-shift" className="tf-section__title">{tx(S.shiftTitle)}</h2>
        <span className="sc-nav">
          <Link className="btn btn--sm" to={`/schedule?view=week&teacherIds=${encodeURIComponent(teacherId)}`}>{tx(S.openSchedule)}</Link>
          {canEdit && q.data && (
            <button type="button" className="btn btn--sm btn--primary" onClick={() => setEditing(true)}>{tx(S.changeShift)}</button>
          )}
        </span>
      </div>
      <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {q.data && (() => {
          const [current, ...earlier] = q.data.patterns
          if (!current) return <p className="tf-muted">{tx(S.shiftNone)}</p>
          return (
            <>
              <p>
                <strong>{tx(CATEGORY_LABEL[current.category])}</strong>{' '}
                <span className="tf-muted">{tx(S.shiftSince, { date: fmt(current.validFrom) })}</span>
              </p>
              {current.category === 'hourly' ? <p className="tf-muted">{tx(S.shiftHourly)}</p> : <Windows windows={current.windows} zone={current.timezone} />}
              {earlier.length > 0 && (
                <details>
                  <summary>{tx(S.shiftHistory)}</summary>
                  <ul className="sc-history">
                    {earlier.map((p) => (
                      <li key={p.id}>
                        {tx(CATEGORY_LABEL[p.category])} · {tx(S.shiftUntil, { from: fmt(p.validFrom), to: p.validTo ? fmt(p.validTo) : '…' })}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )
        })()}
      </QueryBoundary>
      {editing && q.data && <ShiftDialog teacherId={teacherId} data={q.data} onClose={() => setEditing(false)} />}
    </section>
  )
}

function Windows({ windows, zone }: { windows: ShiftWindow[]; zone: string }) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const byDay = WEEKDAYS.map((w) => ({ w, ranges: windows.filter((x) => x.weekday === w.iso) }))
  return (
    <>
      <dl className="tf-kv">
        {byDay.map(({ w, ranges }) => (
          <div key={w.iso} className="sc-kvrow">
            <dt>{tx(w.label)}</dt>
            <dd>{ranges.length === 0 ? tx(S.dayOff) : <bdi>{ranges.map((r) => `${wallClock12(r.start, locale)} – ${wallClock12(r.end, locale)}`).join(' · ')}</bdi>}</dd>
          </div>
        ))}
      </dl>
      <p className="tf-byline" dir="ltr">{zone}</p>
    </>
  )
}

type ShiftCategory = Exclude<Category, 'unset'>
type Rows = Record<number, Array<{ start: string; end: string }>>

function rowsFrom(windows: ShiftWindow[]): Rows {
  const rows: Rows = {}
  for (const w of WEEKDAYS) rows[w.iso] = windows.filter((x) => x.weekday === w.iso).map((x) => ({ start: x.start, end: x.end }))
  return rows
}

function rowsFromDefault(d: ShiftDefault): Rows {
  return rowsFrom(d.weekdays.map((weekday) => ({ weekday, start: d.start, end: d.end })))
}

function ShiftDialog({ teacherId, data, onClose }: { teacherId: string; data: WorkPatterns; onClose: () => void }) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const current: WorkPattern | undefined = data.patterns[0]
  const [category, setCategory] = useState<ShiftCategory>(current?.category ?? 'full_shift')
  const [validFrom, setValidFrom] = useState(data.today ?? academyToday())
  const [timezone, setTimezone] = useState(current?.timezone ?? ACADEMY_ZONE)
  const [rows, setRows] = useState<Rows>(() =>
    current && current.category !== 'hourly' ? rowsFrom(current.windows) : rowsFromDefault(data.defaults.full_shift),
  )
  const [apply, setApply] = useState(true)
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const save = useSetWorkPattern(teacherId)
  const shift = category !== 'hourly'
  // Bookable hours change at once, so only a shift starting today carries them.
  const startsToday = validFrom === (data.today ?? academyToday())
  /** The category's default shift (a part shift's for part, otherwise the full one). */
  const def = data.defaults[category === 'part_shift' ? 'part_shift' : 'full_shift']

  const pickCategory = (c: ShiftCategory) => {
    setCategory(c)
    if (c !== 'hourly') setRows(rowsFromDefault(data.defaults[c]))
  }
  const setRow = (iso: number, i: number, key: 'start' | 'end', v: string) =>
    setRows((r) => ({ ...r, [iso]: r[iso]!.map((x, j) => (j === i ? { ...x, [key]: v } : x)) }))

  const submit = () => {
    setProblem(null)
    const windows = WEEKDAYS.flatMap((w) => rows[w.iso]!.map((r) => ({ weekday: w.iso, start: r.start, end: r.end })))
    if (shift && windows.length === 0) return setProblem(tx(S.needDay))
    if (shift && windows.some((w) => w.end !== '24:00' && w.end <= w.start)) return setProblem(tx(S.badWindow))
    save.mutate(
      {
        category,
        timezone,
        validFrom,
        ...(shift ? { windows, applyToAvailability: apply && startsToday } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      },
      { onSuccess: onClose, onError: (e) => setProblem(describeScheduleError(e, locale)) },
    )
  }

  return (
    <Dialog
      title={tx(S.changeShift)}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--sm" onClick={onClose}>{tx(S.cancel)}</button>
          <button type="button" className="btn btn--sm btn--primary" disabled={save.isPending} onClick={submit}>{tx(S.save)}</button>
        </>
      }
    >
      <div className="field">
        <span className="field__label" id="sc-cat">{tx(S.fCategory)}</span>
        <div className="sc-nav" role="radiogroup" aria-labelledby="sc-cat">
          {(['full_shift', 'part_shift', 'hourly'] as const).map((c) => (
            <label key={c} className="sc-check">
              <input type="radio" name="sc-category" checked={category === c} onChange={() => pickCategory(c)} />
              {tx(CATEGORY_LABEL[c])}
            </label>
          ))}
        </div>
      </div>
      <label className="field">
        <span className="field__label">{tx(S.validFrom)}</span>
        <input type="date" className="input" min={data.today} value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        <span className="field__hint">{tx(S.validFromHint)}</span>
      </label>
      <label className="field">
        <span className="field__label">{tx(S.timezone)}</span>
        <input className="input" dir="ltr" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
      </label>
      {shift ? (
        <fieldset className="field sc-windows">
          <legend className="field__label">{tx(S.windows)}</legend>
          {WEEKDAYS.map((w) => (
            <div key={w.iso} className="sc-windows__day">
              <span className="sc-windows__name">{tx(w.label)}</span>
              <div className="sc-windows__ranges">
                {rows[w.iso]!.length === 0 && <span className="sc-muted">{tx(S.dayOff)}</span>}
                {rows[w.iso]!.map((r, i) => (
                  <span key={i} className="sc-windows__range">
                    <ClockSelect label={`${tx(w.label)} ${tx(S.from)}`} value={r.start} onChange={(v) => setRow(w.iso, i, 'start', v)} />
                    <span aria-hidden="true">–</span>
                    <ClockSelect label={`${tx(w.label)} ${tx(S.to)}`} value={r.end} onChange={(v) => setRow(w.iso, i, 'end', v)} end />
                    <button type="button" className="btn btn--sm btn--ghost" onClick={() => setRows((x) => ({ ...x, [w.iso]: x[w.iso]!.filter((_, j) => j !== i) }))}>
                      {tx(S.removeWindow)}
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  onClick={() => setRows((x) => ({ ...x, [w.iso]: [...x[w.iso]!, { start: def.start, end: def.end }] }))}
                >
                  {tx(S.addWindow)}
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="btn btn--sm" onClick={() => setRows(rowsFromDefault(def))}>{tx(S.useDefaults)}</button>
        </fieldset>
      ) : (
        <p className="sc-hint">{tx(S.shiftHourly)}</p>
      )}
      {shift && startsToday && (
        <label className="sc-check field">
          <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} />
          <span>
            {tx(S.applyToAvailability)}
            <span className="field__hint"> {tx(S.applyHint)}</span>
          </span>
        </label>
      )}
      {shift && !startsToday && <p className="field__hint">{tx(S.applyLater)}</p>}
      <label className="field">
        <span className="field__label">{tx(S.reason)}</span>
        <textarea className="textarea" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {problem && <p className="field__error" role="alert">{problem}</p>}
    </Dialog>
  )
}

/** Every quarter hour of the day, "HH:MM" (an end may be "24:00"). */
const QUARTERS = Array.from({ length: 97 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`)

/**
 * A wall-clock time on the 12-hour clock. A select rather than `<input type="time">`,
 * whose display follows the browser's locale and cannot be made 12-hour; the value
 * stays "HH:MM", as the API takes it. A time off the quarter hour keeps its own option.
 */
function ClockSelect({ label, value, onChange, end = false }: { label: string; value: string; onChange: (v: string) => void; end?: boolean }) {
  const { locale } = useI18n()
  const times = end ? QUARTERS.slice(1) : QUARTERS.slice(0, -1)
  const all = times.includes(value) ? times : [value, ...times].sort()
  return (
    <SearchableSelect className="select select--sm" aria-label={label} value={value} onValueChange={(v) => onChange(v)}>
      {all.map((t) => (
        <option key={t} value={t}>{t === '24:00' ? `${wallClock12(t, locale)} +1` : wallClock12(t, locale)}</option>
      ))}
    </SearchableSelect>
  )
}
