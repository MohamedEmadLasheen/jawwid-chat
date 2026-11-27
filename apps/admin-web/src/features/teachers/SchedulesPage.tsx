import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { ActionDialog } from './ActionDialog'
import { TeachersAreaTabs } from './area'
import { opsApi, type Availability } from './opsApi'
import { O, WEEKDAY, describeOpsError, formatDay } from './opsCopy'
import { useAvailability, useOp, useRoster } from './opsHooks'
import { StudentScheduleDesk, useTx } from './StudentScheduleDesk'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { Icon } from '@/shared/components/Icon'
import './teachers.css'

const DEFAULT_ZONE = 'Africa/Cairo'
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

/**
 * The Teachers department's scheduling desk (PD-11 T2-T3): pick a teacher, then
 * set their weekly working hours and days off, and for each of their students
 * the regular lesson times (lessons are created from them four weeks ahead),
 * a one-off lesson, moving one lesson, a change of teacher, or a pause / stop.
 * PD-31: every time is picked from the free times the server offers (chips),
 * never typed. Every save is re-checked by the server -- a time another student
 * holds, a teacher already busy -- and its refusal is shown as it is.
 */
export function SchedulesPage() {
  const tx = useTx()
  const roster = useRoster()
  const [params, setParams] = useSearchParams()
  const teacherId = params.get('teacher')

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
  }

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader
          title={tx(O.schedulesTitle)}
          subtitle={tx(O.schedulesSubtitle)}
          actions={
            /* Whose desk this is: the one control everything below answers to. */
            <label className="ts-pick__field">
              <span className="sr-only">{tx(O.chooseTeacher)}</span>
              <SearchableSelect className="select" value={teacherId ?? ''} onValueChange={(v) => pickTeacher(v)} aria-label={tx(O.chooseTeacher)}>
                <option value="">{tx(O.pickTeacher)}</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </SearchableSelect>
            </label>
          }
          tabs={<TeachersAreaTabs />}
        />
        <QueryBoundary isLoading={roster.isLoading} error={roster.error} onRetry={() => void roster.refetch()}>
          {!teacher && (
            <div className="sheet">
              <EmptyState title={tx(O.pickTeacher)} hint={tx(O.pickTeacherFirst)} />
            </div>
          )}
          {teacher && (
            <div className="split split--wide-aside">
              <div>
                <StudentScheduleDesk students={students} />
              </div>
              <aside>
                <WorkingHours teacherId={teacher.id} />
              </aside>
            </div>
          )}
        </QueryBoundary>
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
      <section className="sheet ts-hours" aria-label={tx(O.workingHours)}>
        <header className="sheet__head">
          <h2 className="sheet__title">{tx(O.workingHours)}</h2>
        </header>
        <div className="sheet__body">
        {q.data && q.data.windows.length === 0 && <p className="ts-muted ts-section__hint">{tx(O.noAvailabilityYet)}</p>}
        <div className="field ts-inline">
          <label className="field__label" htmlFor={`tz-${teacherId}`}>{tx(O.timezone)}</label>
          <input id={`tz-${teacherId}`} className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </div>
        <div className="ts-windows">
          {windows.map((w, i) => (
            <div className="ts-window" key={i} data-window={i}>
              <SearchableSelect className="select" aria-label={`${tx(O.when)} ${i + 1}`} value={w.weekday} onValueChange={(v) => set(i, { weekday: Number(v) })}>
                {WEEKDAYS.map((d) => <option key={d} value={d}>{tx(WEEKDAY[d]!)}</option>)}
              </SearchableSelect>
              <input className="input" type="time" aria-label={`start ${i + 1}`} value={w.start} onChange={(e) => set(i, { start: e.target.value })} />
              <span aria-hidden>–</span>
              <input className="input" type="time" aria-label={`end ${i + 1}`} value={w.end} onChange={(e) => set(i, { end: e.target.value })} />
              <button type="button" className="btn btn--sm btn--ghost btn--icon" aria-label={tx(O.remove)} title={tx(O.remove)} onClick={() => setWindows((x) => x.filter((_, j) => j !== i))}>
                <Icon name="close" size={16} />
              </button>
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
              <span>
                <bdi>{formatDay(d.date, locale)}</bdi>
                {d.reason && <span className="ts-muted" dir="auto">{locale === 'ar' ? '، ' : ', '}{d.reason}</span>}
              </span>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => removeOff.mutate(d.date)}>{tx(O.remove)}</button>
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
        </div>
      </section>
    </QueryBoundary>
  )
}
