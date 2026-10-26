import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ACADEMY_ZONE, zoneLabel } from '@/core/time/academyTime'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { FilterChips } from '@/shared/components/FilterChips'
import type { CalendarLesson } from './api'
import { S, VIEW_LABEL, dayLabel, useScheduleText } from './copy'
import { FilterBar } from './FilterBar'
import { useCalendarOptions, useCalendarStats, useCalendarSummary, useCalendarWindow } from './hooks'
import { PaletteStyle } from './palette'
import { Legend, LessonDetails, StatsBar } from './Panels'
import { DayView, MonthView, WeekView } from './Timeline'
import { VIEWS, academyToday, addDays, apiQuery, parseViewState, rangeFor, step, toParams, type View, type ViewState } from './viewState'
import './schedule.css'

/**
 * PD-38: the academy's scheduling calendar -- every teacher's shift, lessons
 * and empty time, by day, week or month, with combinable filters and the
 * figures for exactly what is shown.
 *
 * Everything the page shows is in the URL (view, date, filters), so a filtered
 * view can be sent to a colleague. An Operations supervisor opens on their own
 * students (the department head's decision); clearing the filter shows the
 * academy, other supervisors' children as anonymous colored blocks.
 */
export function SchedulePage() {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const [params, setParams] = useSearchParams()
  const today = useMemo(() => academyToday(), [])
  const state = useMemo(() => parseViewState(params, today), [params, today])
  const update = useCallback((next: ViewState) => setParams(toParams(next), { replace: false }), [setParams])
  const [lesson, setLesson] = useState<CalendarLesson | null>(null)

  const options = useCalendarOptions()
  const q = useMemo(() => apiQuery(state), [state])
  const month = state.view === 'month'
  const win = useCalendarWindow(q, !month && !options.isError)
  const summary = useCalendarSummary(q, month && !options.isError)
  const stats = useCalendarStats(q)

  // An Operations supervisor starts on their own students, once per visit.
  const defaulted = useRef(false)
  useEffect(() => {
    const viewer = options.data?.viewer
    if (!viewer || defaulted.current) return
    defaulted.current = true
    if (viewer.scope === 'supervisor' && !params.has('supervisorIds')) {
      setParams(toParams({ ...state, lists: { ...state.lists, supervisorIds: [viewer.staffId] } }), { replace: true })
    }
  }, [options.data, params, setParams, state])

  const setView = (view: View) => update({ ...state, view })
  const openDay = (date: string) => update({ ...state, view: 'day', date })
  const range = rangeFor(state.view, state.date)
  const title =
    state.view === 'day'
      ? dayLabel(range.from, locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : state.view === 'week'
        ? `${dayLabel(range.from, locale, { day: 'numeric', month: 'short' })} – ${dayLabel(addDays(range.to, -1), locale, { day: 'numeric', month: 'short', year: 'numeric' })}`
        : dayLabel(range.from, locale, { month: 'long', year: 'numeric' })

  const supervisors = options.data?.supervisors ?? []
  const toggleSupervisor = (id: string) => {
    const on = state.lists.supervisorIds
    update({ ...state, lists: { ...state.lists, supervisorIds: on.includes(id) ? on.filter((x) => x !== id) : [...on, id] } })
  }
  const active = month ? summary : win
  const teachers = month ? summary.data?.teachers : win.data?.teachers

  return (
    <div className="page sc-page">
      <PaletteStyle />
      <div className="page__inner page__inner--wide">
        <PageHeader
          title={tx(S.title)}
          subtitle={tx(S.zoneNote, { zone: zoneLabel(options.data?.zone ?? ACADEMY_ZONE, locale) })}
        />

        <QueryBoundary isLoading={options.isLoading} error={options.error} onRetry={() => void options.refetch()}>
          <div className="sc-toolbar">
            <FilterChips
              variant="tabs"
              label={tx(S.viewLabel)}
              value={state.view}
              onChange={setView}
              options={VIEWS.map((v) => ({ value: v, label: tx(VIEW_LABEL[v]) }))}
            />
            <div className="sc-nav">
              <button type="button" className="btn btn--sm" aria-label={tx(S.previous)} onClick={() => update({ ...state, date: step(state.view, state.date, -1) })}>
                <span aria-hidden="true" className="sc-flip">‹</span>
              </button>
              <button type="button" className="btn btn--sm" onClick={() => update({ ...state, date: today })}>{tx(S.today)}</button>
              <button type="button" className="btn btn--sm" aria-label={tx(S.next)} onClick={() => update({ ...state, date: step(state.view, state.date, 1) })}>
                <span aria-hidden="true" className="sc-flip">›</span>
              </button>
              <label className="sc-date">
                <span className="sr-only">{tx(S.date)}</span>
                <input type="date" className="input" value={state.date} onChange={(e) => e.target.value && update({ ...state, date: e.target.value })} />
              </label>
              <h2 className="sc-range" aria-live="polite">{title}</h2>
            </div>
          </div>

          <FilterBar state={state} options={options.data} onChange={update} />
          {options.data?.viewer.scope === 'supervisor' && state.lists.supervisorIds.includes(options.data.viewer.staffId) && (
            <p className="sc-hint">{tx(S.mineDefault)}</p>
          )}

          <StatsBar stats={stats.data} loading={stats.isFetching} />
          <Legend supervisors={supervisors} selected={state.lists.supervisorIds} onToggle={toggleSupervisor} />

          <QueryBoundary isLoading={active.isLoading} error={active.error} onRetry={() => void active.refetch()}>
            <div className="sc-scroll" aria-busy={active.isFetching}>
              {teachers && teachers.length === 0 && <EmptyState title={tx(S.noTeachers)} />}
              {teachers && teachers.length > 0 && (
                <>
                  {state.view === 'day' && win.data && <DayView data={win.data} day={range.from} onLesson={setLesson} />}
                  {state.view === 'week' && win.data && <WeekView data={win.data} onLesson={setLesson} onOpenDay={openDay} />}
                  {month && summary.data && <MonthView data={summary.data} onOpenDay={(d) => openDay(d)} />}
                </>
              )}
            </div>
          </QueryBoundary>
        </QueryBoundary>
      </div>
      {lesson && <LessonDetails lesson={lesson} supervisors={supervisors} onClose={() => setLesson(null)} />}
    </div>
  )
}
