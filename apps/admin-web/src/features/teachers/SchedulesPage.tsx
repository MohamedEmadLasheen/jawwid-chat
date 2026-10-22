import { useEffect, useId, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { ActionDialog, type FieldSpec, type FieldValue } from './ActionDialog'
import { TeachersAreaTabs } from './area'
import type { Pair } from './copy'
import { opsApi, type Availability, type Roster, type SuspensionReason, type TransferReason, type WeeklySlot } from './opsApi'
import { O, SUSPENSION_REASON, TRANSFER_REASON, WEEKDAY, describeOpsError, formatDay, formatMinutes } from './opsCopy'
import { useAvailability, useOp, useRoster } from './opsHooks'
import { academyWallClockToIso } from '@/core/time/academyTime'
import './teachers.css'

type Learner = Roster['learners'][number]
type Pending = { title: string; fields: FieldSpec[]; submit: (v: FieldValue) => Promise<unknown> } | null

const DEFAULT_ZONE = 'Africa/Cairo'
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

/**
 * The Teachers department's scheduling desk (PD-11 T2-T3): pick a teacher, then
 * set their weekly working hours and days off, and for each of their students
 * the regular lesson times (lessons are created from them four weeks ahead),
 * a one-off lesson, a transfer to another teacher, or a pause / stop. Every
 * save is re-checked by the server -- a time another student holds, a teacher
 * already busy -- and its refusal is shown as it is.
 */
export function SchedulesPage() {
  const tx = useTx()
  const { locale } = useI18n()
  const roster = useRoster()
  const [params, setParams] = useSearchParams()
  const teacherId = params.get('teacher')
  const [dialog, setDialog] = useState<Pending>(null)
  const [slotsFor, setSlotsFor] = useState<Learner | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const op = useOp((f: () => Promise<unknown>) => f())
  const run = (title: string, fields: FieldSpec[], submit: (v: FieldValue) => Promise<unknown>) =>
    setDialog({ title, fields, submit: (v) => op.mutateAsync(() => submit(v)) })

  const teachers = roster.data?.teachers ?? []
  const teacher = teachers.find((t) => t.id === teacherId) ?? null
  const students = useMemo(
    () => (roster.data?.learners ?? []).filter((l) => l.teacherId === teacherId),
    [roster.data, teacherId],
  )

  const pickTeacher = (id: string) => {
    const next = new URLSearchParams(params)
    if (id) next.set('teacher', id)
    else next.delete('teacher')
    setParams(next)
    setNotice(null)
  }

  return (
    <div className="page">
      <div className="page__inner">
        <TeachersAreaTabs />
        <PageHeader title={tx(O.schedulesTitle)} subtitle={tx(O.schedulesSubtitle)} />
        <QueryBoundary isLoading={roster.isLoading} error={roster.error} onRetry={() => void roster.refetch()}>
          <label className="ts-month">
            <span className="field__label">{tx(O.chooseTeacher)}</span>
            <select className="select" value={teacherId ?? ''} onChange={(e) => pickTeacher(e.target.value)} aria-label={tx(O.chooseTeacher)}>
              <option value="">{tx(O.pickTeacher)}</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          {notice && <div className="banner banner--info" role="status">{notice}</div>}
          {teacher && (
            <>
              <WorkingHours teacherId={teacher.id} />
              <section className="card" aria-label={tx(O.students)}>
                <h2 className="ts-card__title">{tx(O.students)}</h2>
                {students.length === 0 ? (
                  <p className="ts-muted">{tx(O.noStudents)}</p>
                ) : (
                  <div className="table-wrap">
                    <table className="table ts-plain-rows">
                      <thead>
                        <tr>
                          <th scope="col">{tx(O.learner)}</th>
                          <th scope="col">{tx(O.family)}</th>
                          <th scope="col">{tx(O.regularTimes)}</th>
                          <th scope="col">{tx(O.actions)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {students.map((l) => (
                          <tr key={l.id}>
                            <th scope="row">
                              {l.name}
                              {l.suspension && (
                                <span className="badge ts-badge-gap">
                                  {l.suspension.kind === 'temporary'
                                    ? tx(O.paused).replace('{date}', l.suspension.returnOn ? formatDay(l.suspension.returnOn, locale) : '')
                                    : tx(O.stopped)}
                                </span>
                              )}
                            </th>
                            <td>{l.family.displayName}</td>
                            <td>{l.slots.length ? l.slots.map((s) => slotLabel(tx, s, locale)).join(' · ') : <span className="ts-muted">{tx(O.none)}</span>}</td>
                            <td className="ts-actions-cell">
                              <button type="button" className="btn btn--sm" onClick={() => setSlotsFor(l)}>{tx(O.editTimes)}</button>
                              <button
                                type="button"
                                className="btn btn--sm"
                                onClick={() =>
                                  run(tx(O.oneOff), [
                                    { key: 'startsAt', label: O.startsAt, type: 'datetime', required: true },
                                    { key: 'minutes', label: O.minutes, type: 'number', required: true, initial: String(l.slots[0]?.durationMinutes ?? 30) },
                                  ], (v) => {
                                    // PD-22: typed on the academy's (Cairo) clock, not the browser's.
                                    const typed = v('startsAt')
                                    const start = new Date(academyWallClockToIso(typed.slice(0, 10), typed.slice(11, 16)) ?? Number.NaN)
                                    return opsApi.schedule({
                                      learnerId: l.id,
                                      startsAt: start.toISOString(),
                                      endsAt: new Date(start.getTime() + Number(v('minutes')) * 60_000).toISOString(),
                                    })
                                  })
                                }
                              >
                                {tx(O.oneOff)}
                              </button>
                              <button
                                type="button"
                                className="btn btn--sm"
                                onClick={() =>
                                  run(`${tx(O.transfer)} — ${l.name}`, [
                                    {
                                      key: 'toTeacherId',
                                      label: O.toTeacher,
                                      type: 'select',
                                      options: teachers.filter((t) => t.isActive && t.id !== l.teacherId).map((t) => ({ value: t.id, label: { en: t.name, ar: t.name } })),
                                    },
                                    {
                                      key: 'reason',
                                      label: O.reason,
                                      type: 'select',
                                      options: Object.entries(TRANSFER_REASON).map(([value, label]) => ({ value, label })),
                                    },
                                    { key: 'handoverNote', label: O.handover, type: 'textarea' },
                                    { key: 'note', label: O.internalNote, type: 'textarea' },
                                  ], async (v) => {
                                    const r = await opsApi.transfer(l.id, {
                                      toTeacherId: v('toTeacherId'),
                                      reason: v('reason') as TransferReason,
                                      handoverNote: v('handoverNote') || undefined,
                                      note: v('note') || undefined,
                                    })
                                    setNotice(
                                      tx(O.transferDone).replace('{moved}', String(r.lessonsMoved)).replace('{moved2}', String(r.lessonsRescheduled)) +
                                        (r.scheduleKept ? '' : ` ${tx(O.transferTimesLost)}`),
                                    )
                                    return r
                                  })
                                }
                              >
                                {tx(O.transfer)}
                              </button>
                              {!l.suspension && (
                                <button
                                  type="button"
                                  className="btn btn--sm"
                                  onClick={() =>
                                    run(`${tx(O.suspend)} — ${l.name}`, [
                                      { key: 'kind', label: O.kind, type: 'select', options: [{ value: 'temporary', label: O.temporary }, { value: 'permanent', label: O.permanent }] },
                                      { key: 'reason', label: O.reason, type: 'select', options: Object.entries(SUSPENSION_REASON).map(([value, label]) => ({ value, label })) },
                                      { key: 'returnOn', label: O.returnOn, type: 'date' },
                                      { key: 'note', label: O.noteOptional, type: 'textarea' },
                                    ], (v) =>
                                      opsApi.suspend(l.id, {
                                        kind: v('kind') as 'temporary' | 'permanent',
                                        reason: v('reason') as SuspensionReason,
                                        note: v('note') || undefined,
                                        // The server refuses a pause without a return date, and a stop with one.
                                        ...(v('kind') === 'temporary' ? { returnOn: v('returnOn') } : {}),
                                      }),
                                    )
                                  }
                                >
                                  {tx(O.suspend)}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
          {!teacher && <EmptyState title={tx(O.pickTeacher)} />}
        </QueryBoundary>
        {dialog && <ActionDialog title={dialog.title} fields={dialog.fields} onSubmit={dialog.submit} onClose={() => setDialog(null)} />}
        {slotsFor && <SlotsDialog learner={slotsFor} onClose={() => setSlotsFor(null)} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Working hours and days off
// ---------------------------------------------------------------------------

function WorkingHours({ teacherId }: { teacherId: string }) {
  const tx = useTx()
  const { locale } = useI18n()
  const q = useAvailability(teacherId)
  const save = useOp((body: { timezone: string; windows: Availability['windows'] }) => opsApi.setAvailability(teacherId, body))
  const addOff = useOp((body: { date: string; reason?: string }) => opsApi.addDayOff(teacherId, body))
  const removeOff = useOp((date: string) => opsApi.removeDayOff(teacherId, date))
  const [timezone, setTimezone] = useState(DEFAULT_ZONE)
  const [windows, setWindows] = useState<Availability['windows']>([])
  const [offOpen, setOffOpen] = useState(false)

  useEffect(() => {
    if (q.data) {
      setTimezone(q.data.timezone ?? DEFAULT_ZONE)
      setWindows(q.data.windows)
    }
  }, [q.data])

  const set = (i: number, patch: Partial<Availability['windows'][number]>) =>
    setWindows((w) => w.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  return (
    <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
      <section className="card" aria-label={tx(O.workingHours)}>
        <h2 className="ts-card__title">{tx(O.workingHours)}</h2>
        {q.data && q.data.windows.length === 0 && <p className="ts-muted">{tx(O.noAvailabilityYet)}</p>}
        <div className="field ts-inline">
          <label className="field__label" htmlFor={`tz-${teacherId}`}>{tx(O.timezone)}</label>
          <input id={`tz-${teacherId}`} className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </div>
        <div className="ts-windows">
          {windows.map((w, i) => (
            <div className="ts-window" key={i} data-window={i}>
              <select className="select" aria-label={`${tx(O.when)} ${i + 1}`} value={w.weekday} onChange={(e) => set(i, { weekday: Number(e.target.value) })}>
                {WEEKDAYS.map((d) => <option key={d} value={d}>{tx(WEEKDAY[d]!)}</option>)}
              </select>
              <input className="input" type="time" aria-label={`start ${i + 1}`} value={w.start} onChange={(e) => set(i, { start: e.target.value })} />
              <span aria-hidden>–</span>
              <input className="input" type="time" aria-label={`end ${i + 1}`} value={w.end} onChange={(e) => set(i, { end: e.target.value })} />
              <button type="button" className="btn btn--sm" onClick={() => setWindows((x) => x.filter((_, j) => j !== i))}>{tx(O.remove)}</button>
            </div>
          ))}
        </div>
        <div className="ts-row__actions">
          <button type="button" className="btn btn--sm" onClick={() => setWindows((w) => [...w, { weekday: 1, start: '16:00', end: '20:00' }])}>{tx(O.addWindow)}</button>
          <button type="button" className="btn btn--primary btn--sm" disabled={save.isPending} onClick={() => save.mutate({ timezone, windows })}>
            {save.isPending ? tx(O.saving) : tx(O.saveHours)}
          </button>
        </div>
        {save.error && <div className="banner banner--danger" role="alert">{describeOpsError(save.error, locale)}</div>}
        {save.isSuccess && <span className="ts-muted" role="status">{tx(O.done)}</span>}

        <h3 className="ts-subtitle">{tx(O.daysOff)}</h3>
        {q.data && q.data.daysOff.length === 0 && <p className="ts-muted">{tx(O.noDaysOff)}</p>}
        <ul className="ts-daysoff">
          {q.data?.daysOff.map((d) => (
            <li key={d.date}>
              <span>{d.date}{d.reason ? ` — ${d.reason}` : ''}</span>
              <button type="button" className="btn btn--sm" onClick={() => removeOff.mutate(d.date)}>{tx(O.remove)}</button>
            </li>
          ))}
        </ul>
        {removeOff.error && <div className="banner banner--danger" role="alert">{describeOpsError(removeOff.error, locale)}</div>}
        <button type="button" className="btn btn--sm" onClick={() => setOffOpen(true)}>{tx(O.addDayOff)}</button>
        {offOpen && (
          <ActionDialog
            title={tx(O.addDayOff)}
            fields={[
              { key: 'date', label: O.when, type: 'date', required: true },
              { key: 'reason', label: O.noteOptional, type: 'text' },
            ]}
            onSubmit={(v) => addOff.mutateAsync({ date: v('date'), reason: v('reason') || undefined })}
            onClose={() => setOffOpen(false)}
          />
        )}
      </section>
    </QueryBoundary>
  )
}

// ---------------------------------------------------------------------------
// A student's regular times
// ---------------------------------------------------------------------------

function SlotsDialog({ learner, onClose }: { learner: Learner; onClose: () => void }) {
  const tx = useTx()
  const { locale } = useI18n()
  const base = useId()
  const save = useOp((body: { slots: WeeklySlot[]; effectiveFrom?: string }) => opsApi.setSchedule(learner.id, body))
  const [slots, setSlots] = useState<WeeklySlot[]>(learner.slots.length ? learner.slots : [{ weekday: 1, start: '17:00', durationMinutes: 30 }])
  const [from, setFrom] = useState('')
  const set = (i: number, patch: Partial<WeeklySlot>) => setSlots((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  const submit = async () => {
    try {
      await save.mutateAsync({ slots, ...(from ? { effectiveFrom: from } : {}) })
      onClose()
    } catch {
      /* shown below */
    }
  }

  return (
    <Dialog
      title={`${tx(O.regularTimes)} — ${learner.name}`}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={save.isPending || slots.length === 0} onClick={() => void submit()}>
            {save.isPending ? tx(O.saving) : tx(O.saveTimes)}
          </button>
        </>
      }
    >
      {slots.map((s, i) => (
        <div className="ts-window" key={i}>
          <select className="select" aria-label={`${tx(O.when)} ${i + 1}`} value={s.weekday} onChange={(e) => set(i, { weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((d) => <option key={d} value={d}>{tx(WEEKDAY[d]!)}</option>)}
          </select>
          <input className="input" type="time" aria-label={`start ${i + 1}`} value={s.start} onChange={(e) => set(i, { start: e.target.value })} />
          <input className="input ts-narrow" type="number" min={15} max={240} step={5} aria-label={`${tx(O.minutes)} ${i + 1}`} value={s.durationMinutes} onChange={(e) => set(i, { durationMinutes: Number(e.target.value) })} />
          <button type="button" className="btn btn--sm" onClick={() => setSlots((x) => x.filter((_, j) => j !== i))}>{tx(O.remove)}</button>
        </div>
      ))}
      <button type="button" className="btn btn--sm" onClick={() => setSlots((x) => [...x, { weekday: 1, start: '17:00', durationMinutes: x[0]?.durationMinutes ?? 30 }])}>
        {tx(O.addTime)}
      </button>
      <div className="field">
        <label className="field__label" htmlFor={`${base}-from`}>{tx(O.effectiveFrom)}</label>
        <input id={`${base}-from`} className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      {save.error && <div className="banner banner--danger" role="alert">{describeOpsError(save.error, locale)}</div>}
    </Dialog>
  )
}

function slotLabel(tx: (p: Pair) => string, s: WeeklySlot, locale: 'ar' | 'en'): string {
  return `${tx(WEEKDAY[s.weekday] ?? { en: '?', ar: '?' })} ${s.start} (${formatMinutes(s.durationMinutes, locale)})`
}

function useTx() {
  const { locale } = useI18n()
  return (p: Pair) => (locale === 'ar' ? p.ar : p.en)
}
