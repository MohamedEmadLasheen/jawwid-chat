import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ACADEMY_ZONE, zoneLabel } from '@/core/time/academyTime'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { FilterChips } from '@/shared/components/FilterChips'
import { Dialog } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { useMediaQuery } from '@/shared/hooks/useMediaQuery'
import { AgendaView, MonthAgenda } from './Agenda'
import type { CalendarLesson } from './api'
import { S, VIEW_LABEL, WEEKDAYS, dayLabel, useScheduleText } from './copy'
import { FilterBar } from './FilterBar'
import { useCalendarOptions, useCalendarStats, useCalendarSummary, useCalendarWindow } from './hooks'
import { PaletteStyle } from './palette'
import { ByTeacherTable, Legend, LessonDetails, MastStats, SheetFacts } from './Panels'
import { DayView, MonthView, WeekView } from './Timeline'
import { VIEWS, academyToday, activeFilterCount, addDays, apiQuery, daysOf, isoWeekday, parseViewState, rangeFor, step, toParams, weekStart, type View, type ViewState } from './viewState'
import './schedule.css'

/** Whether the filter rail is folded down to its icons: the person's own choice, kept on this browser. */
const FILTERS_FOLDED_KEY = 'jawwid.schedule.filters-folded'
function readFolded(): boolean {
  try {
    return localStorage.getItem(FILTERS_FOLDED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * PD-38: the academy's scheduling calendar -- every teacher's shift, lessons
 * and empty time, by day, week or month, with combinable filters and the
 * figures for exactly what is shown.
 *
 * A tool with a frame: the masthead holds the range being looked at, the steps,
 * the three views and the view's four figures; the filters are a rail at the
 * start (a sheet on a phone); the grid is one white sheet with a sticky head row
 * and teacher column, and its legend in the sheet's foot.
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
  // A phone: the agenda, and the filters in a bottom sheet (owner, 2026-10-28).
  const narrow = useMediaQuery('(max-width: 720px)')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [byTeacher, setByTeacher] = useState(false)
  // The desktop filter rail folds down to its icons, and stays as it was left.
  const [folded, setFolded] = useState(readFolded)
  const fold = (next: boolean) => {
    setFolded(next)
    try {
      localStorage.setItem(FILTERS_FOLDED_KEY, next ? '1' : '0')
    } catch {
      // Storage blocked: the row still folds for this visit.
    }
  }

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

  const nFilters = activeFilterCount(state)
  const mine = options.data?.viewer.scope === 'supervisor' && state.lists.supervisorIds.includes(options.data.viewer.staffId)

  return (
    <div className={`page sc-page${narrow ? ' sc-page--narrow' : ''}`}>
      <PaletteStyle />
      <div className="page__inner">
        <header className="page-header mast mast--tabs sc-mast">
          <div className="mast__row">
            <div className="page-header__text">
              <h1 className="page-header__title">{tx(S.title)}</h1>
              <p className="page-header__subtitle">{tx(S.zoneNote, { zone: zoneLabel(options.data?.zone ?? ACADEMY_ZONE, locale) })}</p>
            </div>
            <div className="page-header__actions sc-nav">
              <DateJump title={title} date={state.date} label={tx(S.date)} onPick={(date) => update({ ...state, date })} />
              {/* The steps follow the reading direction, as the grid's axis does. */}
              <div className="sc-nav__step">
                <button type="button" className="btn btn--icon" aria-label={tx(S.previous)} title={tx(S.previous)} onClick={() => update({ ...state, date: step(state.view, state.date, -1) })}>
                  <span aria-hidden="true" className="sc-chev sc-chev--earlier" />
                </button>
                <button type="button" className="btn" onClick={() => update({ ...state, date: today })}>{tx(S.today)}</button>
                <button type="button" className="btn btn--icon" aria-label={tx(S.next)} title={tx(S.next)} onClick={() => update({ ...state, date: step(state.view, state.date, 1) })}>
                  <span aria-hidden="true" className="sc-chev sc-chev--later" />
                </button>
              </div>
            </div>
          </div>
          {/* The figures appear with their numbers, never as an empty frame. */}
          {stats.data && <MastStats stats={stats.data} loading={stats.isFetching} />}
          <div className="mast__tabs">
            <FilterChips
              variant="tabs"
              label={tx(S.viewLabel)}
              value={state.view}
              onChange={setView}
              options={VIEWS.map((v) => ({ value: v, label: tx(VIEW_LABEL[v]) }))}
            />
          </div>
        </header>

        <QueryBoundary isLoading={options.isLoading} error={options.error} onRetry={() => void options.refetch()}>
          <div className={`sc-work${folded ? ' sc-work--folded' : ''}`}>
            {!narrow && (
              <aside className="sc-rail">
                <button
                  type="button"
                  className="sc-rail__toggle"
                  aria-expanded={!folded}
                  aria-label={tx(folded ? S.railOpen : S.railFold)}
                  title={tx(folded ? S.railOpen : S.railFold)}
                  onClick={() => fold(!folded)}
                >
                  <Icon name="filter" size={18} />
                  <span className="sc-filter__label">{tx(S.filters)}</span>
                  {nFilters > 0 && <span className="count">{nFilters}</span>}
                  <span className="sc-rail__caret" aria-hidden="true"><Icon name="caretLeft" size={14} /></span>
                </button>
                <FilterBar state={state} options={options.data} onChange={update} layout="rail" />
              </aside>
            )}

            <div className="sheet sc-sheet">
              <div className="sheet-bar sc-sheet__bar">
                {narrow && (
                  <button type="button" className="btn sc-filters-button" aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
                    {tx(S.filtersButton)}
                    {nFilters > 0 && <span className="sc-filter__count">{nFilters}</span>}
                  </button>
                )}
                <SheetFacts stats={stats.data} />
                {(stats.data?.teachers.length ?? 0) > 0 && (
                  <div className="sheet-bar__end">
                    <button type="button" className="btn btn--sm" aria-expanded={byTeacher} onClick={() => setByTeacher((v) => !v)}>
                      <Icon name="rows" size={16} />
                      {tx(S.byTeacher)}
                    </button>
                  </div>
                )}
              </div>
              {mine && <p className="sc-hint sc-sheet__note">{tx(S.mineDefault)}</p>}
              {stats.data?.lessonFilter && <p className="sc-hint sc-sheet__note">{tx(S.capacityNote)}</p>}
              {byTeacher && stats.data && <ByTeacherTable stats={stats.data} />}
              {narrow && state.view === 'day' && <DateStrip date={state.date} today={today} onPick={(date) => update({ ...state, date })} />}

              <QueryBoundary isLoading={active.isLoading} error={active.error} onRetry={() => void active.refetch()}>
                {teachers && teachers.length === 0 && <EmptyState title={tx(S.noTeachers)} hint={tx(S.noTeachersHint)} />}
                <div className={narrow ? 'sc-agenda-wrap' : 'sc-scroll'} aria-busy={active.isFetching}>
                  {teachers && teachers.length > 0 && narrow && (
                    <>
                      {!month && win.data && <AgendaView data={win.data} onLesson={setLesson} />}
                      {month && summary.data && <MonthAgenda data={summary.data} onOpenDay={openDay} />}
                    </>
                  )}
                  {teachers && teachers.length > 0 && !narrow && (
                    <>
                      {state.view === 'day' && win.data && <DayView data={win.data} day={range.from} onLesson={setLesson} />}
                      {state.view === 'week' && win.data && <WeekView data={win.data} onLesson={setLesson} onOpenDay={openDay} />}
                      {month && summary.data && <MonthView data={summary.data} onOpenDay={(d) => openDay(d)} />}
                    </>
                  )}
                </div>
              </QueryBoundary>
              <Legend supervisors={supervisors} selected={state.lists.supervisorIds} onToggle={toggleSupervisor} />
            </div>
          </div>
        </QueryBoundary>
      </div>
      {lesson && <LessonDetails lesson={lesson} supervisors={supervisors} onClose={() => setLesson(null)} />}
      {narrow && filtersOpen && (
        <Dialog
          title={tx(S.filters)}
          variant="sheet"
          onClose={() => setFiltersOpen(false)}
          footer={<button type="button" className="btn btn--primary" onClick={() => setFiltersOpen(false)}>{tx(S.done)}</button>}
        >
          <FilterBar state={state} options={options.data} onChange={update} layout="sheet" />
        </Dialog>
      )}
    </div>
  )
}

/**
 * The range being looked at, in the display face; it opens a small popover to
 * jump to a date. Escape and a click outside close it.
 */
function DateJump({ title, date, label, onPick }: { title: string; date: string; label: string; onPick: (date: string) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  return (
    <div className="sc-jump" ref={box}>
      <button type="button" className="sc-jump__button" aria-haspopup="dialog" aria-expanded={open} title={label} onClick={() => setOpen((v) => !v)}>
        <span className="sc-range" aria-live="polite">{title}</span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="sc-jump__panel" role="dialog" aria-label={label}>
          <label className="field">
            <span className="field__label">{label}</span>
            <input
              type="date"
              className="input"
              value={date}
              autoFocus
              onChange={(e) => {
                if (!e.target.value) return
                onPick(e.target.value)
                setOpen(false)
              }}
            />
          </label>
        </div>
      )}
    </div>
  )
}

/** A phone's day view: the week as a strip of days, the open one marked. */
function DateStrip({ date, today, onPick }: { date: string; today: string; onPick: (date: string) => void }) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const from = weekStart(date)
  return (
    <div className="sc-strip" role="group" aria-label={tx(S.date)}>
      {daysOf(from, addDays(from, 7)).map((d) => (
        <button
          key={d}
          type="button"
          className={d === today ? 'sc-strip__day sc-strip__day--today' : 'sc-strip__day'}
          aria-pressed={d === date}
          aria-label={dayLabel(d, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
          onClick={() => onPick(d)}
        >
          <span className="sc-strip__name">{tx(WEEKDAYS.find((w) => w.iso === isoWeekday(d))!.short)}</span>
          <span className="sc-strip__n">{Number(d.slice(8))}</span>
        </button>
      ))}
    </div>
  )
}
