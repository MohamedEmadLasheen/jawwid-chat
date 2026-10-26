import { useMemo, useState, type ReactNode } from 'react'
import type { CalendarOptions, CalendarStatus, Category, LessonKind } from './api'
import { CATEGORY_LABEL, KIND_LABEL, S, STATUS_LABEL, WEEKDAYS, useScheduleText, type Pair } from './copy'
import { activeFilterCount, clearFilters, type ListFilter, type ScalarFilter, type ViewState } from './viewState'

/**
 * PD-38 filters (the owner's top priority). Every chip is a multi-select that
 * combines with every other; the choice goes into the URL, and the calendar and
 * the stats bar re-read with it. Nothing is filtered in the browser: the
 * server applies each filter in SQL, so the numbers always match what is drawn.
 */

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
  return (
    <details className="sc-filter">
      <summary className={`chip${count > 0 ? ' sc-filter--on' : ''}`} aria-label={count > 0 ? `${label} (${count})` : label}>
        {label}
        {count > 0 && <span className="sc-filter__count">{count}</span>}
      </summary>
      <div className="sc-filter__panel">{children}</div>
    </details>
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
}: {
  state: ViewState
  options: CalendarOptions | undefined
  onChange: (next: ViewState) => void
}) {
  const tx = useScheduleText()
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
    <div className="sc-filters" role="group" aria-label={tx(S.filters)}>
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
            <select className="select select--sm" value={state.scalars.timeFrom ?? ''} onChange={(e) => setScalar('timeFrom', e.target.value)}>
              <option value="">{tx(S.any)}</option>
              {HOURS.slice(0, 24).map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{tx(S.to)}</span>
            <select className="select select--sm" value={state.scalars.timeTo ?? ''} onChange={(e) => setScalar('timeTo', e.target.value)}>
              <option value="">{tx(S.any)}</option>
              {HOURS.slice(1).map((h) => <option key={h} value={h === '24:00' ? '24:00' : h}>{h}</option>)}
            </select>
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
          <select className="select select--sm" value={state.scalars.emptyMinutesGte ?? ''} onChange={(e) => setScalar('emptyMinutesGte', e.target.value)}>
            <option value="">{tx(S.any)}</option>
            {[1, 2, 4, 8, 16, 40].map((h) => (
              <option key={h} value={String(h * 60)}>{tx(S.emptyAtLeast, { h })}</option>
            ))}
          </select>
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
  )
}
