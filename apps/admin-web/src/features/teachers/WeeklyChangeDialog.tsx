import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ACADEMY_ZONE, clockIn, dayMonthIn, isoToAcademyWallClock, weekdayIn } from '@/core/time/academyTime'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { QueryBoundary } from '@/shared/components/States'
import { LockedNotice, WeeklySlotPicker, weeklyKey, type WeeklyOption } from '@/shared/components/SlotPicker'
import type { Pair } from './copy'
import { opsApi, type ScheduleOptions } from './opsApi'
import { O, arrow, describeOpsError, fill } from './opsCopy'
import { useOp, useScheduleOptions } from './opsHooks'
import './teachers.css'

type Current = ScheduleOptions['current'][number]

/** One weekly time in the edit: kept, changed, removed, or added. */
interface Row {
  id: number
  original: Current | null
  next: WeeklyOption | null
  removed: boolean
}

type RowState = 'unchanged' | 'changed' | 'removed' | 'added' | 'pending'

function stateOf(r: Row): RowState {
  if (r.original) {
    if (r.removed) return 'removed'
    if (r.next && weeklyKey(r.next) !== weeklyKey(r.original)) return 'changed'
    return 'unchanged'
  }
  return r.next ? 'added' : 'pending'
}

/** "Mon 17:00" on the academy's clock, from the time's next start. */
export function weeklyLabel(nextStartsAt: string, locale: 'ar' | 'en'): string {
  return `${weekdayIn(nextStartsAt, ACADEMY_ZONE, locale)} ${clockIn(nextStartsAt, ACADEMY_ZONE, locale)}`
}

/** A YYYY-MM-DD calendar day as "3 Nov". */
export function dayLabel(day: string, locale: 'ar' | 'en'): string {
  return dayMonthIn(`${day}T12:00:00Z`, 'UTC', locale)
}

/**
 * The before -> after of a weekly change, as one line and the weeks skipped:
 * "Mon 17:00 → Tue 18:00 from 3 Nov; Thu 17:00 unchanged". Exported for the
 * Needs-action card, which shows a request the same way.
 */
export function weeklySummary(rows: Row[], from: string, locale: 'ar' | 'en'): { line: string; skipped: string[] } {
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const date = dayLabel(from, locale)
  const parts: string[] = []
  const skipped: string[] = []
  for (const r of rows) {
    const s = stateOf(r)
    if (s === 'pending') continue
    const fromLabel = r.original ? weeklyLabel(r.original.nextStartsAt, locale) : ''
    const toLabel = r.next ? weeklyLabel(r.next.nextStartsAt, locale) : ''
    if (s === 'unchanged') parts.push(fill(tx(O.sumUnchanged), { from: fromLabel }))
    else if (s === 'removed') parts.push(fill(tx(O.sumRemoved), { from: fromLabel, date }))
    else if (s === 'changed') parts.push(fill(tx(O.sumChanged), { from: fromLabel, to: toLabel, date }))
    else parts.push(fill(tx(O.sumAdded), { to: toLabel, date }))
    if ((s === 'changed' || s === 'added') && r.next) {
      const weeks = r.next.except.filter((d) => isoToAcademyWallClock(d).date >= from)
      if (weeks.length) {
        skipped.push(
          fill(tx(O.sumSkipped), {
            time: toLabel,
            dates: weeks.map((d) => dayMonthIn(d, ACADEMY_ZONE, locale)).join(locale === 'ar' ? '، ' : ', '),
          }),
        )
      }
    }
  }
  return { line: parts.join(locale === 'ar' ? '؛ ' : '; '), skipped }
}

/**
 * PD-31 "Every week" for staff: the child's current weekly times as cards. Tap
 * one to replace it with a free time (GET /learners/:id/schedule-options), add
 * or remove one, pick "from", read the before -> after, and Save -- POST
 * /learners/:id/schedule with the FULL new set, applied at once. The length is
 * kept from the current times.
 */
export function WeeklyChangeDialog({ learner, onClose }: { learner: { id: string; name: string }; onClose: () => void }) {
  const q = useScheduleOptions(learner.id)
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  return (
    <Dialog title={fill(tx(O.weeklyTitle), { name: learner.name })} onClose={onClose} footer={!q.data ? <DialogCancelButton onClick={onClose} /> : undefined}>
      <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {q.data && <WeeklyEditor learnerId={learner.id} data={q.data} onRefresh={() => void q.refetch()} onClose={onClose} />}
      </QueryBoundary>
    </Dialog>
  )
}

function WeeklyEditor({
  learnerId,
  data,
  onRefresh,
  onClose,
}: {
  learnerId: string
  data: ScheduleOptions
  onRefresh: () => void
  onClose: () => void
}) {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const base = useId()
  const today = isoToAcademyWallClock(new Date().toISOString()).date
  const [rows, setRows] = useState<Row[]>(() => data.current.map((c, i) => ({ id: i, original: c, next: null, removed: false })))
  const [editing, setEditing] = useState<number | null>(null)
  const [from, setFrom] = useState(today)
  const save = useOp((body: { slots: Array<{ weekday: number; start: string; durationMinutes: number }>; effectiveFrom: string }) =>
    opsApi.setSchedule(learnerId, body),
  )

  const set = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const kept = rows.filter((r) => !r.removed && (r.next || r.original))
  const newSet = kept.map((r) => {
    const t = (r.next ?? r.original)!
    return { weekday: t.weekday, start: t.start, durationMinutes: r.original?.durationMinutes ?? data.durationMinutes }
  })
  const states = rows.map(stateOf)
  const pending = states.includes('pending')
  const changed = states.some((s) => s === 'changed' || s === 'added' || s === 'removed')
  const summary = weeklySummary(rows, from || today, locale)
  const blocked = !changed || pending || newSet.length === 0 || !!data.locked || !from

  /** The options a row may take: free, and not another row's time. */
  const optionsFor = (row: Row) => {
    const taken = new Set(rows.filter((r) => r.id !== row.id && !r.removed).map((r) => (r.next ?? r.original) && weeklyKey((r.next ?? r.original)!)))
    return data.options.filter((o) => !taken.has(weeklyKey(o)))
  }

  const submit = async () => {
    if (blocked || save.isPending) return
    try {
      await save.mutateAsync({ slots: newSet, effectiveFrom: from })
      onClose()
    } catch {
      // A time just taken: the offer is refreshed and the refusal shown below.
      onRefresh()
    }
  }

  const addRow = () => {
    const id = Math.max(-1, ...rows.map((r) => r.id)) + 1
    setRows((rs) => [...rs, { id, original: null, next: null, removed: false }])
    setEditing(id)
  }

  if (data.locked) return <LockedNotice />

  return (
    <>
      <p className="ts-muted">{tx(O.weeklyHint)}</p>
      <h3 className="ts-subtitle">{tx(O.currentTimes)}</h3>
      {rows.length === 0 && <p className="ts-muted">{tx(O.noWeeklyTimes)}</p>}
      <ul className="ts-weekly">
        {rows.map((r, i) => {
          const s = states[i]!
          const label = r.original ? weeklyLabel(r.original.nextStartsAt, locale) : tx(O.addedTime)
          return (
            <li key={r.id} className={`ts-weekly__card ts-weekly__card--${s}`} data-row={r.id}>
              <div className="ts-weekly__head">
                <span className="ts-weekly__time">
                  <span className={s === 'removed' || s === 'changed' ? 'ts-weekly__old' : undefined}>{label}</span>
                  {r.next && s !== 'unchanged' && (
                    <>
                      {arrow(locale)}
                      <strong>{weeklyLabel(r.next.nextStartsAt, locale)}</strong>
                    </>
                  )}
                  {s === 'removed' && <span className="badge ts-badge-gap">{tx(O.removed)}</span>}
                </span>
                <span className="ts-row__actions">
                  {s !== 'removed' && (
                    <button type="button" className="btn btn--sm" aria-expanded={editing === r.id} onClick={() => setEditing(editing === r.id ? null : r.id)}>
                      {tx(O.change)}{r.original ? ` ${label}` : ''}
                    </button>
                  )}
                  {(s === 'changed' || s === 'removed') && (
                    <button type="button" className="btn btn--sm" onClick={() => set(r.id, { next: null, removed: false })}>
                      {tx(O.undo)}
                    </button>
                  )}
                  {s !== 'removed' && (
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => {
                        if (r.original) set(r.id, { removed: true, next: null })
                        else setRows((rs) => rs.filter((x) => x.id !== r.id))
                        if (editing === r.id) setEditing(null)
                      }}
                    >
                      {tx(O.remove)}{r.original ? ` ${label}` : ''}
                    </button>
                  )}
                </span>
              </div>
              {editing === r.id && s !== 'removed' && (
                <WeeklySlotPicker
                  options={optionsFor(r)}
                  value={r.next ?? (r.original ? { weekday: r.original.weekday, start: r.original.start } : null)}
                  onChange={(o) => {
                    set(r.id, { next: o })
                    setEditing(null)
                  }}
                  label={tx(r.original ? O.pickReplacement : O.pickNewTime)}
                />
              )}
            </li>
          )
        })}
      </ul>
      <button type="button" className="btn btn--sm" onClick={addRow}>
        + {tx(O.addTime)}
      </button>
      <div className="field ts-inline">
        <label className="field__label" htmlFor={`${base}-from`}>{tx(O.fromDate)}</label>
        <input id={`${base}-from`} className="input" type="date" min={today} value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <section className="ts-summary" aria-label={tx(O.summary)}>
        <h3 className="ts-subtitle">{tx(O.summary)}</h3>
        {changed ? <p data-testid="weekly-summary">{summary.line}</p> : <p className="ts-muted">{tx(O.noChange)}</p>}
        {changed && summary.skipped.map((s) => <p key={s} className="ts-attention">{s}</p>)}
      </section>
      {pending && <p className="field__error">{tx(O.pickPending)}</p>}
      {save.error && <div className="banner banner--danger" role="alert">{describeOpsError(save.error, locale)}</div>}
      <div className="dialog__actions">
        <DialogCancelButton onClick={onClose} />
        <button type="button" className="btn btn--primary" disabled={blocked || save.isPending} onClick={() => void submit()}>
          {save.isPending ? tx(O.saving) : tx(O.saveTimes)}
        </button>
      </div>
    </>
  )
}
