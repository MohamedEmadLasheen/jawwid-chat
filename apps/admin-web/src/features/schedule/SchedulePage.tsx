import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { isSuperAdmin } from '@/core/permissions/capabilities'
import { ACADEMY_ZONE, zoneLabel } from '@/core/time/academyTime'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { Dialog } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { useMediaQuery } from '@/shared/hooks/useMediaQuery'
import { useLessonAccess } from '@/features/teachers/hooks'
import { AgendaView, MonthAgenda } from './Agenda'
import type { CalendarLesson } from './api'
import { AttentionPanel, type Highlight } from './Attention'
import { MonthView, WeekBoard } from './Board'
import { S, VIEW_LABEL, WEEKDAYS, dayLabel, useScheduleText } from './copy'
import { FilterBar } from './FilterBar'
import { useCalendarOptions, useCalendarStats, useCalendarSummary, useCalendarWindow, useNow, useStoredFlag, useWeekStart } from './hooks'
import { findIssues, type Findings } from './issues'
import { PaletteStyle } from './palette'
import { ByTeacherTable, Figures, HeatKey, LegendHelp, LessonDetails } from './Panels'
import { DayView } from './Timeline'
import { VIEWS, academyToday, activeFilterCount, addDays, clearFilters, apiQuery, daysOf, isoWeekday, parseViewState, rangeFor, step, toParams, weekStart, type View, type ViewState } from './viewState'
import './schedule.css'

const NO_FINDINGS: Findings = { issues: [], clashing: new Set(), uncovered: new Set(), absent: new Set(), byCell: new Map() }
const NOTHING: ReadonlySet<string> = new Set()

/**
 * PD-38: the academy's schedule. One question first: what in the academy's
 * day breaks, and where is there room? -- every teacher's working hours,
 * lessons and leave on the academy clock, by day, week or month, with what
 * needs a person listed beside it.
 *
 * The header holds the title and the range, the steps (previous, today, next
 * as one control), the views and the legend's "?"; under it the teacher and
 * supervisor filters (the rest behind "More filters") and the view's figures.
 * The grid is one white sheet that fills the window; "Needs your attention"
 * sits at its end and folds away.
 *
 * Everything the grid shows is in the URL (view, date, filters), so a filtered
 * view can be sent to a colleague. An Operations supervisor opens on their own
 * students (the department head's decision); clearing the filter shows the
 * academy, other supervisors' children as anonymous coloured blocks.
 *
 * No lesson is created from this page (the desks create them), so it has no
 * primary action.
 */
export function SchedulePage() {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const { staff } = useSession()
  const [params, setParams] = useSearchParams()
  const today = useMemo(() => academyToday(), [])
  const now = useNow()
  const [weekStartsOn, setWeekStart] = useWeekStart()
  const state = useMemo(() => parseViewState(params, today), [params, today])
  const update = useCallback((next: ViewState) => setParams(toParams(next), { replace: false }), [setParams])
  const [lesson, setLesson] = useState<CalendarLesson | null>(null)
  // A phone: the agenda, and the filters in a bottom sheet (owner, 2026-10-28).
  const narrow = useMediaQuery('(max-width: 720px)')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [byTeacher, setByTeacher] = useState(false)
  const [more, setMore] = useStoredFlag('jawwid.schedule.filters-open')
  const [attnFolded, setAttnFolded] = useStoredFlag('jawwid.schedule.attention-folded', typeof window !== 'undefined' && window.innerWidth < 1366 && window.innerWidth > 720)
  const [attnFoldedNarrow, setAttnFoldedNarrow] = useState(true)
  // What an attention item points at: while hovered, and after it is chosen.
  const [hover, setHover] = useState<Highlight | null>(null)
  const [pinned, setPinned] = useState<Highlight | null>(null)
  const highlight = hover ?? pinned

  const options = useCalendarOptions()
  const q = useMemo(() => apiQuery(state, weekStartsOn), [state, weekStartsOn])
  const month = state.view === 'month'
  const win = useCalendarWindow(q, !month && !options.isError)
  const summary = useCalendarSummary(q, month && !options.isError)
  const stats = useCalendarStats(q)
  // The Teachers department's desk, where a student's teacher is changed (the super admin holds every area).
  const operator = staff !== null && !isSuperAdmin(staff.role)
  const access = useLessonAccess(operator)
  const deskAccess = !operator || access.data?.lessonManager === true

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

  const range = rangeFor(state.view, state.date, weekStartsOn)
  const findings = useMemo(() => (!month && win.data ? findIssues(win.data) : NO_FINDINGS), [month, win.data])
  const teacherNames = useMemo(() => new Map((win.data?.teachers ?? options.data?.teachers ?? []).map((t) => [t.id, t.name])), [win.data, options.data])
  const teacherName = useCallback((id: string) => teacherNames.get(id) ?? '', [teacherNames])

  // A chosen item stays lit only on the view it came from.
  useEffect(() => {
    setPinned(null)
    setHover(null)
  }, [state.view, state.date])

  const setView = (view: View) => update({ ...state, view })
  /** Open a day; from a board cell, that teacher's row is brought into view and lit. */
  const focusRef = useRef<string | null>(null)
  const openDay = (date: string, teacherId?: string) => {
    focusRef.current = teacherId ?? null
    update({ ...state, view: 'day', date })
  }
  useEffect(() => {
    const id = focusRef.current
    if (!id || state.view !== 'day' || !win.data || win.isFetching) return
    focusRef.current = null
    setPinned({ teacherId: id, lessonIds: [] })
    document.querySelector(`.sc-grid [data-teacher="${CSS.escape(id)}"]`)?.scrollIntoView?.({ block: 'center', inline: 'nearest' })
  }, [state.view, win.data, win.isFetching])

  const reveal = (h: Highlight) => {
    setPinned(h)
    const first = h.lessonIds[0]
    const el = first
      ? document.querySelector<HTMLElement>(`.sc-grid [data-lesson="${CSS.escape(first)}"]`)
      : document.querySelector<HTMLElement>(`.sc-grid [data-teacher="${CSS.escape(h.teacherId)}"]`)
    el?.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' })
  }

  // T jumps to today, from anywhere on the page but a field or a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 't' && e.key !== 'T' && e.code !== 'KeyT') return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="listbox"]')) return
      if (document.querySelector('.dialog-backdrop')) return
      e.preventDefault()
      update({ ...state, date: today })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [state, today, update])

  const title =
    state.view === 'day'
      ? dayLabel(range.from, locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : state.view === 'week'
        ? `${dayLabel(range.from, locale, { day: 'numeric', month: 'short' })} – ${dayLabel(addDays(range.to, -1), locale, { day: 'numeric', month: 'short', year: 'numeric' })}`
        : dayLabel(range.from, locale, { month: 'long', year: 'numeric' })
  const isCurrent = range.from <= today && today < range.to

  const supervisors = options.data?.supervisors ?? []
  const toggleSupervisor = (id: string) => {
    const on = state.lists.supervisorIds
    update({ ...state, lists: { ...state.lists, supervisorIds: on.includes(id) ? on.filter((x) => x !== id) : [...on, id] } })
  }
  const active = month ? summary : win
  const teachers = month ? summary.data?.teachers : win.data?.teachers

  const nFilters = activeFilterCount(state)
  const mine = options.data?.viewer.scope === 'supervisor' && state.lists.supervisorIds.includes(options.data.viewer.staffId)
  // The month has no lessons loaded: the panel stays, and says where its items are seen.
  // The month loads totals only: no panel; its key says where the list is.
  const showPanel = (teachers?.length ?? 0) > 0 && !month && !!win.data

  const panel = (inline: boolean) => (
    <AttentionPanel
      issues={findings.issues}
      teacherName={teacherName}
      showDay={state.view === 'week'}
      folded={inline ? attnFoldedNarrow : attnFolded}
      onFold={inline ? setAttnFoldedNarrow : setAttnFolded}
      onHighlight={setHover}
      onReveal={reveal}
      onOpenLesson={setLesson}
      deskAccess={deskAccess}
      inline={inline}
      note={month ? tx(S.attnMonth) : undefined}
      onOpenWeek={month ? () => update({ ...state, view: 'week', date: state.date.slice(0, 7) === today.slice(0, 7) ? today : state.date }) : undefined}
    />
  )

  const steps = (
    <div className="sc-step" role="group" aria-label={tx(S.date)}>
      <button type="button" className="sc-step__arrow" aria-label={tx(S.previous)} title={tx(S.previous)} onClick={() => update({ ...state, date: step(state.view, state.date, -1) })}>
        <Icon name="caretLeft" size={18} />
      </button>
      <button type="button" className="sc-step__today" aria-pressed={isCurrent} title="T" onClick={() => update({ ...state, date: today })}>
        {tx(S.today)}
      </button>
      <button type="button" className="sc-step__arrow" aria-label={tx(S.next)} title={tx(S.next)} onClick={() => update({ ...state, date: step(state.view, state.date, 1) })}>
        <Icon name="chevronForward" size={18} />
      </button>
    </div>
  )
  const views = (
    <div className="switch sc-views" role="group" aria-label={tx(S.viewLabel)}>
      {VIEWS.map((v) => (
        <button key={v} type="button" className="sc-view" aria-pressed={state.view === v} onClick={() => setView(v)}>
          {tx(VIEW_LABEL[v])}
        </button>
      ))}
    </div>
  )

  return (
    <div className={`page sc-page${narrow ? ' sc-page--narrow' : ''}`}>
      <PaletteStyle />
      <div className="page__inner sc-inner">
        <header className="page-header mast sc-mast">
          <div className="mast__row sc-mast__row">
            <div className="sc-mast__title">
              <h1 className="page-header__title">{tx(S.title)}</h1>
              <DateJump title={title} date={state.date} label={tx(S.range)} onPick={(date) => update({ ...state, date })} />
              {!narrow && steps}
              <span className="sc-zone">{zoneLabel(options.data?.zone ?? ACADEMY_ZONE, locale)}</span>
            </div>
            <div className="page-header__actions sc-mast__actions">
              {narrow && steps}
              {views}
              {!narrow && (
                <button type="button" className="btn btn--sm sc-byteacher-toggle" aria-expanded={byTeacher} disabled={(stats.data?.teachers.length ?? 0) === 0} onClick={() => setByTeacher((v) => !v)}>
                  <Icon name="rows" size={16} />
                  {tx(S.byTeacher)}
                </button>
              )}
              {!narrow && <LegendHelp supervisors={supervisors} selected={state.lists.supervisorIds} onToggle={toggleSupervisor} />}
            </div>
          </div>
        </header>

        <div className="sc-toolbar">
          {narrow ? (
            <button type="button" className="btn sc-filters-button" aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
              <Icon name="sliders" size={18} />
              {tx(S.filtersButton)}
              {nFilters > 0 && <span className="sc-filter__count">{nFilters}</span>}
            </button>
          ) : (
            <FilterBar
              state={state}
              options={options.data}
              onChange={update}
              more={more}
              onMore={setMore}
              weekStart={weekStartsOn}
              onWeekStart={setWeekStart}
            />
          )}
          <div className="sc-toolbar__end">
            {/* Figures for what is shown: none when no teacher matches. */}
            {!narrow && (teachers?.length ?? 0) > 0 && <Figures stats={stats.data} loading={stats.isFetching} />}
          </div>
        </div>
        {(mine || stats.data?.lessonFilter) && (
          <div className="sc-notes">
            {mine && <p className="sc-note">{tx(S.mineDefault)}</p>}
            {stats.data?.lessonFilter && <p className="sc-note">{tx(S.capacityNote)}</p>}
          </div>
        )}

        <QueryBoundary isLoading={options.isLoading} error={options.error} onRetry={() => void options.refetch()}>
          <div className={`sc-work${showPanel && !narrow ? '' : ' sc-work--solo'}${attnFolded ? ' sc-work--folded' : ''}`}>
            <div className="sheet sc-sheet">
              {byTeacher && stats.data && <ByTeacherTable stats={stats.data} />}
              {narrow && showPanel && panel(true)}
              {narrow && state.view === 'day' && <DateStrip date={state.date} today={today} start={weekStartsOn} onPick={(date) => update({ ...state, date })} />}
              <QueryBoundary isLoading={active.isLoading} error={active.error} onRetry={() => void active.refetch()}>
                {teachers && teachers.length === 0 && (
                  <EmptyState
                    title={tx(S.noTeachers)}
                    hint={tx(S.noTeachersHint)}
                    action={
                      nFilters > 0 && narrow ? (
                        <button type="button" className="btn btn--sm" onClick={() => update(clearFilters(state))}>
                          {tx(S.clearAll)}
                        </button>
                      ) : undefined
                    }
                  />
                )}
                <ScrollBox narrow={narrow} busy={active.isFetching} sideways={state.view === 'day'} watch={win.data}>
                  {teachers && teachers.length > 0 && narrow && (
                    <>
                      {!month && win.data && <AgendaView data={win.data} findings={findings} now={now} onLesson={setLesson} />}
                      {month && summary.data && <MonthAgenda data={summary.data} onOpenDay={(d) => openDay(d)} />}
                    </>
                  )}
                  {teachers && teachers.length > 0 && !narrow && (
                    <>
                      {state.view === 'day' && win.data && (
                        <DayView
                          data={win.data}
                          day={range.from}
                          findings={findings}
                          highlight={highlight && highlight.lessonIds.length > 0 ? new Set(highlight.lessonIds) : NOTHING}
                          highlightTeacher={highlight?.teacherId ?? null}
                          now={now}
                          isToday={range.from === today}
                          onLesson={setLesson}
                        />
                      )}
                      {state.view === 'week' && win.data && (
                        <WeekBoard data={win.data} findings={findings} today={today} highlightTeacher={highlight?.teacherId ?? null} onOpenDay={openDay} />
                      )}
                      {month && summary.data && <MonthView data={summary.data} today={today} onOpenDay={(d, t) => openDay(d, t)} />}
                    </>
                  )}
                </ScrollBox>
                {month && !narrow && (teachers?.length ?? 0) > 0 && (
                  <HeatKey note={tx(S.attnMonth)} onOpenWeek={() => update({ ...state, view: 'week', date: state.date.slice(0, 7) === today.slice(0, 7) ? today : state.date })} />
                )}
              </QueryBoundary>
            </div>
            {showPanel && !narrow && panel(false)}
          </div>
        </QueryBoundary>
      </div>
      {lesson && (
        <LessonDetails
          lesson={lesson}
          supervisors={supervisors}
          teacherName={teacherName(lesson.teacherId) || null}
          clash={findings.clashing.has(lesson.id)}
          uncovered={findings.uncovered.has(lesson.id)}
          deskAccess={deskAccess}
          onClose={() => setLesson(null)}
        />
      )}
      {narrow && filtersOpen && (
        <Dialog
          title={tx(S.filters)}
          variant="sheet"
          onClose={() => setFiltersOpen(false)}
          footer={<button type="button" className="btn btn--primary" onClick={() => setFiltersOpen(false)}>{tx(S.done)}</button>}
        >
          <FilterBar state={state} options={options.data} onChange={update} layout="sheet" weekStart={weekStartsOn} onWeekStart={setWeekStart} />
        </Dialog>
      )}
    </div>
  )
}

/**
 * The grid's scroller. A day longer than the sheet scrolls sideways; then a
 * quiet control at each edge says there are earlier or later hours, and moves
 * three hours that way.
 */
function ScrollBox({ narrow, busy, sideways, watch, children }: { narrow: boolean; busy: boolean; sideways: boolean; watch: unknown; children: ReactNode }) {
  const tx = useScheduleText()
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ earlier: false, later: false })
  const measure = useCallback(() => {
    const el = ref.current
    if (!el || !sideways) return setEdges({ earlier: false, later: false })
    const max = el.scrollWidth - el.clientWidth
    const at = Math.abs(el.scrollLeft)
    setEdges({ earlier: at > 4, later: at < max - 4 })
  }, [sideways])
  useEffect(() => {
    measure()
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, watch])
  const move = (dir: -1 | 1) => {
    const el = ref.current
    if (!el) return
    const hour = el.querySelector<HTMLElement>('.sc-grid--day')?.getBoundingClientRect().width ?? 0
    const hours = Number(el.querySelector<HTMLElement>('.sc-grid--day')?.dataset.hours ?? 1)
    const step = ((hour - (el.querySelector<HTMLElement>('.sc-row__head')?.offsetWidth ?? 0)) / Math.max(1, hours)) * 3
    const rtl = getComputedStyle(el).direction === 'rtl'
    el.scrollBy?.({ left: (rtl ? -dir : dir) * step, behavior: 'smooth' })
  }
  if (narrow) {
    return (
      <div className="sc-agenda-wrap" aria-busy={busy}>
        {children}
      </div>
    )
  }
  return (
    <div className="sc-scrollbox">
      <div ref={ref} className="sc-scroll" aria-busy={busy} onKeyDown={moveBetweenBlocks} onScroll={measure}>
        {children}
      </div>
      {edges.earlier && (
        <button type="button" className="sc-edge sc-edge--earlier" aria-label={tx(S.earlier)} title={tx(S.earlier)} onClick={() => move(-1)}>
          <Icon name="caretLeft" size={18} />
        </button>
      )}
      {edges.later && (
        <button type="button" className="sc-edge sc-edge--later" aria-label={tx(S.later)} title={tx(S.later)} onClick={() => move(1)}>
          <Icon name="chevronForward" size={18} />
        </button>
      )}
    </div>
  )
}

/**
 * The arrow keys move between lessons (the day) or days (the boards): along
 * the row by where each block sits on screen, so the keys follow the axis in
 * either direction; up and down to the nearest block in the next row that has
 * one. Enter opens it (each is a button); Escape closes what opened.
 */
function moveBetweenBlocks(e: ReactKeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
  const from = (e.target as HTMLElement).closest<HTMLElement>('[data-nav]')
  if (!from) return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-nav]')]
  const centre = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  const row = Number(from.dataset.row)
  const at = centre(from)
  let next: HTMLElement | undefined
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const sign = e.key === 'ArrowRight' ? 1 : -1
    next = items
      .filter((el) => el !== from && Number(el.dataset.row) === row && (centre(el).x - at.x) * sign > 0.5)
      .sort((a, b) => Math.abs(centre(a).x - at.x) - Math.abs(centre(b).x - at.x))[0]
  } else {
    const sign = e.key === 'ArrowDown' ? 1 : -1
    const rows = [...new Set(items.map((el) => Number(el.dataset.row)))].filter((r) => (r - row) * sign > 0).sort((a, b) => (a - b) * sign)
    const target = rows[0]
    if (target !== undefined) {
      next = items
        .filter((el) => Number(el.dataset.row) === target)
        .sort((a, b) => Math.abs(centre(a).x - at.x) - Math.abs(centre(b).x - at.x))[0]
    }
  }
  if (next) {
    e.preventDefault()
    next.focus()
    next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }
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

/** A phone's day view: the week as a strip of days, the open one marked, today in gold. */
function DateStrip({ date, today, start, onPick }: { date: string; today: string; start: number; onPick: (date: string) => void }) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const from = weekStart(date, start)
  return (
    <div className="sc-strip" role="group" aria-label={tx(S.date)}>
      {daysOf(from, addDays(from, 7)).map((d) => (
        <button
          key={d}
          type="button"
          className={d === today ? 'sc-strip__day sc-strip__day--today' : 'sc-strip__day'}
          aria-current={d === today ? 'date' : undefined}
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
