import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { wallClock12 } from '@/core/time/academyTime'
import type { CalendarOptions, CalendarStatus, Category, LessonKind } from './api'
import { CATEGORY_LABEL, KIND_LABEL, S, STATUS_LABEL, WEEKDAYS, useScheduleText, type Pair } from './copy'
import { activeFilterCount, clearFilters, type ListFilter, type ScalarFilter, type ViewState } from './viewState'
import { SearchableSelect, belongsToOpenPicker } from '@/shared/components/SearchableSelect'

/**
 * PD-38 filters (the owner's top priority). Every chip is a multi-select that
 * combines with every other; the choice goes into the URL, and the calendar and
 * the stats bar re-read with it. Nothing is filtered in the browser: the
 * server applies each filter in SQL, so the numbers always match what is drawn.
 *
 * One filter is open at a time (owner, 2026-10-28): opening another closes it,
 * and so do a click anywhere outside it and Escape, which returns focus to the
 * filter's button. On a phone the same filters sit in a bottom sheet
 * (`layout="sheet"`), one open at a time there too.
 */

/** Which filter is open: one key, or none. */
const OpenFilter = createContext<{ open: string | null; setOpen: (key: string | null) => void }>({ open: null, setOpen: () => {} })

interface Choice {
  value: string
  label: string
}

function Menu({
  label,
  count,
  children,
}: {
  label: string
  count: number
  children: ReactNode
}) {
  const { open, setOpen } = useContext(OpenFilter)
  const isOpen = open === label
  const panelId = useId()
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    // Into the panel, so the keyboard lands where the choices are.
    panel.current?.querySelector<HTMLElement>('input, select, button')?.focus()
    // A picker's list is portalled to the body: a pointer on it is inside, and
    // while it is open its Escape closes only the list.
    const outside = (e: PointerEvent) => {
      if (belongsToOpenPicker(e.target)) return
      if (box.current && !box.current.contains(e.target as Node)) setOpen(null)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || belongsToOpenPicker(e.target)) return
      e.stopPropagation()
      setOpen(null)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    // Capture: an open filter takes Escape before a surrounding sheet would close.
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [isOpen, setOpen])

  return (
    <div className="sc-filter" ref={box}>
      <button
        ref={trigger}
        type="button"
        className={`chip sc-filter__trigger${count > 0 ? ' sc-filter--on' : ''}`}
        aria-label={count > 0 ? `${label} (${count})` : label}
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen(isOpen ? null : label)}
      >
        {label}
        {count > 0 && <span className="sc-filter__count">{count}</span>}
        <span className="sc-filter__caret" aria-hidden="true" />
      </button>
      {isOpen && (
        <div id={panelId} ref={panel} className="sc-filter__panel" role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  )
}

function Checklist({
  name,
  choices,
  selected,
  onChange,
  searchable = false,
}: {
  name: string
  choices: Choice[]
  selected: string[]
  onChange: (next: string[]) => void
  searchable?: boolean
}) {
  const tx = useScheduleText()
  const [q, setQ] = useState('')
  const shown = useMemo(
    () => (q ? choices.filter((c) => c.label.toLocaleLowerCase().includes(q.toLocaleLowerCase())) : choices),
    [choices, q],
  )
  const on = new Set(selected)
  return (
    <fieldset className="sc-checklist">
      <legend className="sr-only">{name}</legend>
      {searchable && (
        <input
          type="search"
          className="input"
          placeholder={tx(S.search)}
          aria-label={`${tx(S.search)}: ${name}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      {shown.length === 0 && <p className="sc-muted">{tx(S.noOptions)}</p>}
      <div className="sc-checklist__items">
        {shown.map((c) => (
          <label key={c.value} className="sc-check">
            <input
              type="checkbox"
              checked={on.has(c.value)}
              onChange={(e) => onChange(e.target.checked ? [...selected, c.value] : selected.filter((v) => v !== c.value))}
            />
            <span dir="auto">{c.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

const HOURS = Array.from({ length: 25 }, (_, h) => `${String(h).padStart(2, '0')}:00`)

export function FilterBar({
  state,
  options,
  onChange,
  layout = 'inline',
}: {
  state: ViewState
  options: CalendarOptions | undefined
  onChange: (next: ViewState) => void
  /** `sheet`: stacked, full width, for the phone's bottom sheet. */
  layout?: 'inline' | 'sheet'
}) {
  const tx = useScheduleText()
  const { locale } = useI18n()
  const [open, setOpen] = useState<string | null>(null)
  const openFilter = useMemo(() => ({ open, setOpen }), [open])
  const setList = (k: ListFilter) => (next: string[]) => onChange({ ...state, lists: { ...state.lists, [k]: next } })
  const setScalar = (k: ScalarFilter, v: string) => {
    const scalars = { ...state.scalars }
    if (v) scalars[k] = v
    else delete scalars[k]
    onChange({ ...state, scalars })
  }
  const pairs = <T extends string>(rec: Record<T, Pair>, keys: readonly T[]): Choice[] => keys.map((k) => ({ value: k, label: tx(rec[k]) }))
  const list = (k: ListFilter) => state.lists[k]

  const teachers: Choice[] = (options?.teachers ?? []).map((t) => ({ value: t.id, label: t.name }))
  const supervisors: Choice[] = [
    ...(options?.supervisors ?? []).map((s) => ({ value: s.id, label: s.name })),
    { value: 'none', label: tx(S.noSupervisor) },
  ]
  const learners: Choice[] = (options?.learners ?? []).map((l) => ({ value: l.id, label: l.name }))
  const n = activeFilterCount(state)

  return (
    <OpenFilter.Provider value={openFilter}>
    <div className={`sc-filters${layout === 'sheet' ? ' sc-filters--sheet' : ''}`} role="group" aria-label={tx(S.filters)}>
      <Menu label={tx(S.fTeacher)} count={list('teacherIds').length}>
        <Checklist name={tx(S.fTeacher)} choices={teachers} selected={list('teacherIds')} onChange={setList('teacherIds')} searchable />
      </Menu>
      <Menu label={tx(S.fCategory)} count={list('categories').length}>
        <Checklist
          name={tx(S.fCategory)}
          choices={pairs<Category>(CATEGORY_LABEL, ['full_shift', 'part_shift', 'hourly', 'unset'])}
          selected={list('categories')}
          onChange={setList('categories')}
        />
      </Menu>
      <Menu label={tx(S.fSupervisor)} count={list('supervisorIds').length}>
        <Checklist name={tx(S.fSupervisor)} choices={supervisors} selected={list('supervisorIds')} onChange={setList('supervisorIds')} />
      </Menu>
      <Menu label={tx(S.fStudent)} count={list('learnerIds').length}>
        <Checklist name={tx(S.fStudent)} choices={learners} selected={list('learnerIds')} onChange={setList('learnerIds')} searchable />
      </Menu>
      <Menu label={tx(S.fStatus)} count={list('statuses').length}>
        <Checklist
          name={tx(S.fStatus)}
          choices={pairs<CalendarStatus>(STATUS_LABEL, ['active', 'trial', 'paused', 'moved'])}
          selected={list('statuses')}
          onChange={setList('statuses')}
        />
      </Menu>
      <Menu label={tx(S.fKind)} count={list('kinds').length}>
        <Checklist name={tx(S.fKind)} choices={pairs<LessonKind>(KIND_LABEL, ['regular', 'makeup', 'trial'])} selected={list('kinds')} onChange={setList('kinds')} />
      </Menu>
      <Menu label={tx(S.fDays)} count={list('weekdays').length}>
        <Checklist
          name={tx(S.fDays)}
          choices={WEEKDAYS.map((w) => ({ value: String(w.iso), label: tx(w.label) }))}
          selected={list('weekdays')}
          onChange={setList('weekdays')}
        />
      </Menu>
      <Menu label={tx(S.fHours)} count={(state.scalars.timeFrom ? 1 : 0) + (state.scalars.timeTo ? 1 : 0)}>
        <div className="sc-hours">
          <label className="field">
            <span className="field__label">{tx(S.from)}</span>
            <SearchableSelect className="select select--sm" value={state.scalars.timeFrom ?? ''} onValueChange={(v) => setScalar('timeFrom', v)}>
              <option value="">{tx(S.any)}</option>
              {HOURS.slice(0, 24).map((h) => <option key={h} value={h}>{wallClock12(h, locale)}</option>)}
            </SearchableSelect>
          </label>
          <label className="field">
            <span className="field__label">{tx(S.to)}</span>
            <SearchableSelect className="select select--sm" value={state.scalars.timeTo ?? ''} onValueChange={(v) => setScalar('timeTo', v)}>
              <option value="">{tx(S.any)}</option>
              {HOURS.slice(1).map((h) => <option key={h} value={h}>{wallClock12(h, locale)}</option>)}
            </SearchableSelect>
          </label>
        </div>
      </Menu>
      <Menu label={tx(S.fUtilization)} count={list('utilization').length}>
        <Checklist
          name={tx(S.fUtilization)}
          choices={[
            { value: 'lt50', label: tx(S.lt50) },
            { value: '50to80', label: tx(S.to80) },
            { value: 'gte80', label: tx(S.gte80) },
          ]}
          selected={list('utilization')}
          onChange={setList('utilization')}
        />
      </Menu>
      <Menu label={tx(S.fEmpty)} count={state.scalars.emptyMinutesGte ? 1 : 0}>
        <label className="field">
          <span className="field__label">{tx(S.fEmpty)}</span>
          <SearchableSelect className="select select--sm" value={state.scalars.emptyMinutesGte ?? ''} onValueChange={(v) => setScalar('emptyMinutesGte', v)}>
            <option value="">{tx(S.any)}</option>
            {[1, 2, 4, 8, 16, 40].map((h) => (
              <option key={h} value={String(h * 60)}>{tx(S.emptyAtLeast, { h })}</option>
            ))}
          </SearchableSelect>
        </label>
      </Menu>
      <label className="sc-check sc-check--inline">
        <input
          type="checkbox"
          checked={state.scalars.onlyMatching !== 'false'}
          onChange={(e) => setScalar('onlyMatching', e.target.checked ? '' : 'false')}
        />
        <span>{tx(S.onlyMatching)}</span>
      </label>
      {n > 0 && (
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => onChange(clearFilters(state))}>
          {tx(S.clearAll)} ({n})
        </button>
      )}
    </div>
    </OpenFilter.Provider>
  )
}
