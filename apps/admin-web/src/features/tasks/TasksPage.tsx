import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { holdsAny, isSuperAdmin } from '@/core/permissions/capabilities'
import { academyWallClockToIso, ACADEMY_ZONE, clock12In, dayMonthIn, isoToAcademyWallClock } from '@/core/time/academyTime'
import { Badge } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { PageHeader } from '@/shared/components/PageHeader'
import { RowActions } from '@/shared/components/RowActions'
import type { MenuItem } from '@/shared/components/Menu'
import { relativeTime } from '@/features/admin/copy'
import { academyToday, addDays } from '@/features/schedule/viewState'
import { ReasonDialog } from '@/shared/components/ReasonDialog'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { ApiError } from '@/core/api/errors'
import { Icon } from '@/shared/components/Icon'
import { describeError } from '@/features/teacher-files/copy'
import {
  tasksApi,
  type Category,
  type Level,
  type ListQuery,
  type NewTask,
  type Target,
  type TaskDetail,
  type TaskSummary,
  type TaskView,
} from './api'
import { C, DEPARTMENT_LABEL, EVENT_LABEL, GROUP_LABEL, LEVEL_LABEL, SOURCE_LABEL, STATE_LABEL, TAB_LABEL, useCopy } from './copy'
import { reasonOf, sourceLink, stateOf, STATE_TONE, titleOf } from './format'
import { FinanceTag, PriorityChip } from './PriorityChip'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { CASES_ACCESS_KEYS, TasksAreaTabs } from './TasksAreaTabs'
import './tasks.css'

type Tab = TaskView | 'closed'
const LEVELS: Level[] = ['high', 'medium', 'low']
/** The window before a task is due in which its time turns amber. */
const SOON_MS = 24 * 60 * 60 * 1000

const keys = {
  all: ['tasks'] as const,
  list: (q: ListQuery) => ['tasks', 'list', q] as const,
  one: (id: string) => ['tasks', 'one', id] as const,
  assignees: (taskId?: string) => ['tasks', 'assignees', taskId ?? null] as const,
}

/** "3 Nov, 6:00 PM": an instant on the academy's clock, 12-hour (PD-22, owner 2026-10-28). */
function useWhen() {
  const { locale } = useI18n()
  return (iso: string) => `${dayMonthIn(iso, ACADEMY_ZONE, locale)}${locale === 'ar' ? '، ' : ', '}${clock12In(iso, ACADEMY_ZONE, locale)}`
}

function useTitle() {
  const tx = useCopy()
  const { locale, date } = useI18n()
  const when = useWhen()
  return (t: Pick<TaskSummary, 'title' | 'source' | 'titleParams'>) => titleOf(t, tx, { locale, dateTime: when, date })
}

/** Which tabs a person has: their own, then what their keys open (the server decides each list). */
function useTabs(): { tabs: Tab[]; closedViews: TaskView[] } {
  const { staff } = useSession()
  const sa = !!staff && isSuperAdmin(staff.role)
  const team = !sa && holdsAny(staff, ['tasks.team', 'tasks.manage'])
  const decide = holdsAny(staff, ['tasks.manage'])
  const views: TaskView[] = ['mine', ...(team ? (['team'] as const) : []), ...(decide ? (['decisions'] as const) : []), ...(sa ? (['all'] as const) : [])]
  return { tabs: [...views, 'closed'], closedViews: views.filter((v) => v !== 'decisions') }
}

/** When a task is due, as the list groups it. Overdue is the server's own flag, never recomputed. */
type Group = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none'
const GROUPS: Group[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none']
function groupOf(t: Pick<TaskSummary, 'overdue' | 'dueAt'>, today: string): Group {
  if (t.overdue) return 'overdue'
  if (!t.dueAt) return 'none'
  const day = isoToAcademyWallClock(t.dueAt).date
  if (day <= today) return 'today'
  if (day === addDays(today, 1)) return 'tomorrow'
  return day <= addDays(today, 7) ? 'week' : 'later'
}

/**
 * PD-47: one Tasks page for every staff member. Mine, the team's (read-only
 * for a teacher's supervisor), the decisions waiting on the viewer, everything
 * (the super admin), and the closed ones with their history. Nothing here
 * decides who sees or may do what.
 *
 * The page is a queue and an inspector: the masthead says how much of the
 * viewer's own work is late or due today; the list is grouped by when a task
 * is due (overdue first, in the server's order inside each group); the open
 * task stays on screen beside it.
 *
 * Deep links: ?tab=, ?task=<id>, ?overdue=true, ?level=, ?category=.
 */
export function TasksPage({ eyebrow }: { eyebrow?: string }) {
  const tx = useCopy()
  const { staff } = useSession()
  const { number } = useI18n()
  const [params, setParams] = useSearchParams()
  const { tabs, closedViews } = useTabs()
  const asked = params.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(asked && tabs.includes(asked) ? asked : 'mine')
  const [closedView, setClosedView] = useState<TaskView>('mine')
  const askedLevel = params.get('level') as Level | null
  const [level, setLevel] = useState<Level | ''>(askedLevel && LEVELS.includes(askedLevel) ? askedLevel : '')
  const askedCategory = params.get('category') as Category | null
  const [category, setCategory] = useState<Category | ''>(askedCategory === 'financial' || askedCategory === 'operational' ? askedCategory : '')
  const [overdue, setOverdue] = useState(params.get('overdue') === 'true')
  // The Dashboard's tiles open these lists (tile == list); shown as removable filters.
  const [gone, setGone] = useState(params.get('gone') === 'true')
  const [unmanaged, setUnmanaged] = useState(params.get('unmanaged') === 'true')
  const [openId, setOpenId] = useState<string | null>(params.get('task'))
  const [creating, setCreating] = useState(false)
  // The filters fold behind one button; a view that arrives filtered shows them.
  const [filtersOpen, setFiltersOpen] = useState(() => !!(params.get('level') || params.get('category') || params.get('overdue')))
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const { dir } = useI18n()

  // The tab, the filters and the open task live in the URL, so a view can be
  // shared, reloaded, or returned to with Back.
  useEffect(() => {
    const next = new URLSearchParams()
    if (tab !== 'mine') next.set('tab', tab)
    if (level) next.set('level', level)
    if (category) next.set('category', category)
    if (overdue && tab !== 'closed') next.set('overdue', 'true')
    if (gone) next.set('gone', 'true')
    if (unmanaged) next.set('unmanaged', 'true')
    if (openId) next.set('task', openId)
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }, [tab, level, category, overdue, gone, unmanaged, openId, params, setParams])

  const pick = (t: Tab) => {
    setTab(t)
    setOpenId(null)
  }
  // The tabs' own keys (WAI-ARIA tabs): arrows move, Home and End jump; in
  // Arabic the arrows follow the reading direction.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = { ArrowRight: dir === 'rtl' ? -1 : 1, ArrowLeft: dir === 'rtl' ? 1 : -1 }[e.key as 'ArrowRight' | 'ArrowLeft']
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : step !== undefined ? (i + step + tabs.length) % tabs.length : null
    if (to === null) return
    e.preventDefault()
    pick(tabs[to]!)
    tabRefs.current[to]?.focus()
  }

  const query: ListQuery = useMemo(
    () => ({
      view: tab === 'closed' ? closedView : tab,
      state: tab === 'closed' ? 'closed' : 'open',
      level: level || undefined,
      category: category || undefined,
      overdue: tab === 'closed' ? undefined : overdue || undefined,
      gone: gone || undefined,
      unmanaged: unmanaged || undefined,
    }),
    [tab, closedView, level, category, overdue, gone, unmanaged],
  )
  const list = useInfiniteQuery({
    queryKey: keys.list(query),
    queryFn: ({ pageParam }) => tasksApi.list(query, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const canCreate = holdsAny(staff, ['tasks.create'])
  const hasCases = holdsAny(staff, CASES_ACCESS_KEYS)
  const today = academyToday()

  // No figure strip: the overdue group below carries its count, and the Escalations
  // page has none either, so the two pages of this place keep one layout.
  const filterCount = (level ? 1 : 0) + (category ? 1 : 0) + (overdue && tab !== 'closed' ? 1 : 0) + (tab === 'closed' && closedView !== 'mine' ? 1 : 0)
  const grouped = GROUPS.map((g) => ({ group: g, rows: items.filter((t) => groupOf(t, today) === g) })).filter((g) => g.rows.length > 0)
  const row = (t: TaskSummary) => (
    <TaskRow key={t.id} task={t} showAssignee={query.view !== 'mine'} selected={t.id === openId} onOpen={() => setOpenId(t.id)} />
  )

  return (
    <div className="page tasks">
      <div className="page__inner">
        <PageHeader
          eyebrow={eyebrow}
          title={tx(C.title)}
          actions={
            canCreate ? (
              // One primary per screen: with a task open, its own action is the primary one.
              <button type="button" className={openId ? 'btn' : 'btn btn--primary'} onClick={() => setCreating(true)}>
                <Icon name="plus" size={16} />
                {tx(C.newTask)}
              </button>
            ) : undefined
          }
          tabs={hasCases ? <TasksAreaTabs /> : undefined}
        />
        <div className={openId ? 'tq tq--open' : 'tq'}>
          <div className="sheet tq__sheet">
            <div className="sheet-bar">
              <div role="tablist" className="tasks__tabs" aria-label={tx(C.title)}>
                {tabs.map((t, i) => (
                  <button
                    key={t}
                    ref={(el) => {
                      tabRefs.current[i] = el
                    }}
                    id={`tasks-tab-${t}`}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    aria-controls="tasks-tabpanel"
                    tabIndex={tab === t ? 0 : -1}
                    className="tasks__tab"
                    onClick={() => pick(t)}
                    onKeyDown={(e) => onTabKey(e, i)}
                  >
                    {tx(TAB_LABEL[t])}
                  </button>
                ))}
              </div>
              <div className="sheet-bar__end">
                <span className="tq__sort">
                  {tx(tab === 'closed' ? C.sortClosed : C.sortDue)}
                </span>
                {gone && (
                  <button type="button" className="chip tq__clear" aria-label={tx(C.clearFilter, { filter: tx(C.goneOnly) })} onClick={() => setGone(false)}>
                    {tx(C.goneOnly)}
                    <Icon name="close" size={14} />
                  </button>
                )}
                {unmanaged && (
                  <button type="button" className="chip tq__clear" aria-label={tx(C.clearFilter, { filter: tx(C.unmanagedOnly) })} onClick={() => setUnmanaged(false)}>
                    {tx(C.unmanagedOnly)}
                    <Icon name="close" size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--sm tq__filter-toggle"
                  aria-expanded={filtersOpen}
                  aria-controls="tasks-filters"
                  onClick={() => setFiltersOpen((v) => !v)}
                >
                  <Icon name="filter" size={16} />
                  {tx(C.filters)}
                  {filterCount > 0 && <span className="count">{number(filterCount)}</span>}
                </button>
              </div>
            </div>
            {filtersOpen && (
              <div className="sheet-bar tasks__filters" id="tasks-filters">
                {tab === 'closed' && closedViews.length > 1 && (
                  <SearchableSelect className="select" aria-label={tx(C.whose)} value={closedView} onValueChange={(v) => setClosedView(v as TaskView)}>
                    {closedViews.map((v) => (
                      <option key={v} value={v}>{tx(TAB_LABEL[v])}</option>
                    ))}
                  </SearchableSelect>
                )}
                <SearchableSelect className="select" aria-label={tx(C.level)} value={level} onValueChange={(v) => setLevel(v as Level | '')}>
                  <option value="">{tx(C.anyLevel)}</option>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>{tx(LEVEL_LABEL[l])}</option>
                  ))}
                </SearchableSelect>
                <SearchableSelect className="select" aria-label={tx(C.kind)} value={category} onValueChange={(v) => setCategory(v as Category | '')}>
                  <option value="">{tx(C.anyKind)}</option>
                  <option value="financial">{tx({ en: 'Finance', ar: 'مالية' })}</option>
                  <option value="operational">{tx(C.operational)}</option>
                </SearchableSelect>
                {tab !== 'closed' && (
                  <label className="tasks__check">
                    <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> {tx(C.overdueOnly)}
                  </label>
                )}
              </div>
            )}
            <div id="tasks-tabpanel" role="tabpanel" aria-labelledby={`tasks-tab-${tab}`}>
              <QueryBoundary isLoading={list.isLoading} error={list.error} onRetry={() => list.refetch()}>
                {items.length === 0 ? (
                  <EmptyState
                    title={tx(tab === 'closed' ? C.emptyClosed : C.empty)}
                    hint={tx(tab === 'closed' ? C.emptyClosedHint : C.emptyHint)}
                    action={
                      canCreate && tab !== 'closed' ? (
                        <button type="button" className="btn btn--sm" onClick={() => setCreating(true)}>
                          {tx(C.emptyAction)}
                        </button>
                      ) : undefined
                    }
                  />
                ) : tab === 'closed' ? (
                  <ul className="tq-rows">{items.map(row)}</ul>
                ) : (
                  grouped.map(({ group, rows }) => (
                    <section key={group} className={`tq-group tq-group--${group}`} aria-labelledby={`tasks-group-${group}`}>
                      <h2 className="tq-group__head" id={`tasks-group-${group}`}>
                        <span>{tx(GROUP_LABEL[group])}</span>
                        <span className={group === 'overdue' ? 'count count--urgent' : 'count count--quiet'}>{number(rows.length)}</span>
                      </h2>
                      <ul className="tq-rows">{rows.map(row)}</ul>
                    </section>
                  ))
                )}
                {list.hasNextPage && (
                  <div className="tq__more">
                    <button type="button" className="btn btn--sm tasks__more" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                      {tx(C.loadMore)}
                    </button>
                  </div>
                )}
              </QueryBoundary>
            </div>
          </div>
          {/* Keyed by the task: a draft, a dialog or a date typed for one task never carries to the next. */}
          {openId && <TaskPanel key={openId} id={openId} onClose={() => setOpenId(null)} />}
        </div>
      </div>
      {creating && <NewTaskDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

/** Overdue in words and an icon, never by colour alone -- unless the level's own reason already says it. */
function OverdueMark() {
  const tx = useCopy()
  return (
    <span className="tasks__overdue" data-testid="task-overdue">
      <Icon name="alert" size={14} />
      {tx(C.overdue)}
    </span>
  )
}

function TaskRow({ task, showAssignee, selected, onOpen }: { task: TaskSummary; showAssignee: boolean; selected: boolean; onOpen: () => void }) {
  const tx = useCopy()
  const { duration, locale } = useI18n()
  const when = useWhen()
  const title = useTitle()
  const state = stateOf(task)
  const closed = task.state === 'completed' || task.state === 'removed'
  const link = sourceLink(task)
  const late = !closed && task.overdue
  // The last day before it is due is the window: amber, as red is for overdue.
  const soon = !closed && !late && !!task.dueAt && Date.parse(task.dueAt) - Date.now() < SOON_MS
  const name = title(task)
  const sep = locale === 'ar' ? '، ' : ', '
  return (
    <li className={`tq-row${selected ? ' tq-row--selected' : ''}${closed ? ' tq-row--closed' : ''}${late ? ' tq-row--late' : ''}${soon ? ' tq-row--soon' : ''}`}>
      <div className="tq-row__main">
        <button type="button" className="tasks__title" dir="auto" aria-current={selected ? 'true' : undefined} onClick={onOpen}>
          {name}
        </button>
        <div className="tq-row__sub">
          {/* Why it is here, in words: the kind of work for a system task, the person for one somebody gave, and whose it is. */}
          <span className="tq-row__why">
            {task.source ? (
              <span className="tasks__source">{tx(SOURCE_LABEL[task.source.type])}</span>
            ) : (
              task.createdBy && <span className="tasks__source" dir="auto">{tx(C.createdBy, { name: task.createdBy.name })}</span>
            )}
            {showAssignee && (
              <>
                {(task.source || task.createdBy) && sep}
                <span dir="auto">{tx(C.assignedTo, { name: task.assigneeName })}</span>
              </>
            )}
          </span>
          {!closed && <PriorityChip task={task} />}
          {task.category === 'financial' && <FinanceTag />}
          {!closed && state !== 'open' && <Badge tone={STATE_TONE[state]}>{tx(STATE_LABEL[state])}</Badge>}
          {task.needsReassignment && !closed && <Badge tone="waiting">{tx(C.goneOnly)}</Badge>}
        </div>
      </div>
      {/* The one fact a queue is read for: how long until it is due, or how long since. */}
      <div className="tq-row__when">
        {closed ? (
          <>
            <Badge tone={STATE_TONE[state]}>{tx(STATE_LABEL[state])}</Badge>
            {task.closedAt && <span className="tq-row__date">{tx(C.closedOn, { when: when(task.closedAt) })}</span>}
          </>
        ) : task.dueAt ? (
          <>
            <span className="tq-row__age">
              {late && task.priorityReason !== 'overdue' && <OverdueMark />}
              {late ? tx(C.dueAgo, { ago: duration(task.dueAt) }) : relativeTime(task.dueAt, locale)}
            </span>
            <span className="tq-row__date">{tx(C.due, { when: when(task.dueAt) })}</span>
          </>
        ) : (
          <span className="tq-row__date">{tx(C.noDue)}</span>
        )}
      </div>
      {/* One stated action, in a slot of its own width so the column stays straight; the open task's is in its inspector. */}
      <div className="tq-row__act">
        {link && !closed && !selected && (
          <Link className="btn btn--sm" to={link} aria-label={`${tx(C.goPage)}: ${name}`}>
            {tx(C.goPage)}
          </Link>
        )}
      </div>
    </li>
  )
}

function TaskPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const qc = useQueryClient()
  const when = useWhen()
  const title = useTitle()
  const one = useQuery({ queryKey: keys.one(id), queryFn: () => tasksApi.get(id) })
  const t = one.data
  const can = new Set(t?.actions ?? [])
  const [dialog, setDialog] = useState<'out_of_scope' | 'return' | 'remove' | 'reassign' | null>(null)
  const [comment, setComment] = useState('')
  const op = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setDialog(null)
      void qc.invalidateQueries({ queryKey: keys.all })
    },
  })
  const link = t ? sourceLink(t) : null
  const state = t ? stateOf(t) : 'open'
  const due = t?.dueAt ? isoToAcademyWallClock(t.dueAt) : null

  // A link to a task the viewer cannot see (or that is not there) says so; it
  // is not a failure to retry.
  if (one.error instanceof ApiError && (/TASK_NOT_FOUND$/.test(one.error.code) || one.error.status === 404)) {
    return (
      <section className="tasks__panel sheet insp" aria-label={tx(C.title)}>
        <div className="insp__head">
          <div className="insp__top">
            <span />
            <CloseButton onClose={onClose} />
          </div>
          <p className="tasks__text" role="status">{tx(C.notFound)}</p>
        </div>
      </section>
    )
  }

  const live = !!t && t.state !== 'completed' && t.state !== 'removed'
  // One thing to do, stated; everything else the server allows is behind "⋯".
  const secondary: Array<{ key: 'out_of_scope' | 'return' | 'reassign' | 'remove'; label: string; icon: MenuItem['icon']; danger?: boolean }> = [
    ...(can.has('reassign') ? [{ key: 'reassign' as const, label: tx(C.reassign), icon: 'swap' as const }] : []),
    ...(can.has('return') ? [{ key: 'return' as const, label: tx(C.returnTask), icon: 'undo' as const }] : []),
    ...(can.has('out_of_scope') ? [{ key: 'out_of_scope' as const, label: tx(C.outOfScope), icon: 'prohibit' as const }] : []),
    ...(can.has('remove') ? [{ key: 'remove' as const, label: tx(C.remove), icon: 'trash' as const, danger: true }] : []),
  ]
  const completes = can.has('complete') || can.has('acknowledge')
  // With nothing to complete, the first of the rest is the stated action.
  const lead = completes ? null : (secondary[0] ?? null)
  const rest = lead ? secondary.slice(1) : secondary

  return (
    <section className="tasks__panel sheet insp" aria-label={t ? title(t) : tx(C.title)}>
      <QueryBoundary isLoading={one.isLoading} error={one.error} onRetry={() => one.refetch()}>
        {t && (
          <>
            <header className="insp__head">
              <div className="insp__top">
                <h2 className="tasks__panel-title" dir="auto">{title(t)}</h2>
                <CloseButton onClose={onClose} />
              </div>
              <div className="tasks__chips">
                <span className="insp__kind">
                  {t.source || !t.createdBy ? tx(SOURCE_LABEL[t.source?.type ?? 'manual']) : tx(C.createdBy, { name: t.createdBy.name })}
                </span>
                {live && <PriorityChip task={t} />}
                {t.category === 'financial' && <FinanceTag />}
                <Badge tone={STATE_TONE[state]}>{tx(STATE_LABEL[state])}</Badge>
              </div>
            </header>

            <div className="insp__body">
              <dl className="insp__facts">
                <div>
                  <dt>{tx(C.factAssignee)}</dt>
                  <dd dir="auto">{t.assigneeName}</dd>
                </div>
                {t.createdBy && (
                  <div>
                    <dt>{tx(C.factFrom)}</dt>
                    <dd dir="auto">{t.createdBy.name}</dd>
                  </div>
                )}
                <div>
                  <dt>{tx(C.dueAt)}</dt>
                  <dd className={t.overdue && live ? 'insp__late' : undefined}>
                    <span className="insp__when">{t.dueAt ? when(t.dueAt) : tx(C.noDue)}</span>
                    {t.overdue && t.priorityReason !== 'overdue' && live && <OverdueMark />}
                  </dd>
                </div>
                {link && (
                  <div>
                    <dt>{tx(C.factWhere)}</dt>
                    <dd>
                      <Link className="insp__link" to={link}>
                        {tx(C.openSource)}
                        <Icon name="chevronForward" size={14} />
                      </Link>
                    </dd>
                  </div>
                )}
              </dl>

              {t.instructions && t.state === 'open' && (
                <div className="tasks__banner tasks__banner--waiting" role="note">
                  <p className="tasks__banner-title">{tx(C.instructions)}</p>
                  <p className="tasks__text" dir="auto">{t.instructions}</p>
                </div>
              )}
              {t.sourceState === 'withdrawn' && live && <div className="tasks__banner" role="note">{tx(C.withdrawn)}</div>}
              {t.needsReassignment && <div className="tasks__banner" role="note">{tx(C.assigneeLeft)}</div>}
              {t.unmanaged && <div className="tasks__banner" role="note">{tx(C.unmanaged)}</div>}
              {t.body && <p className="tasks__text" dir="auto">{t.body}</p>}
              {t.closeReason && (
                <p className="tasks__text" dir="auto">
                  <strong>{tx(C.closeReason)}:</strong> {t.closeReason}
                </p>
              )}
              {op.error && <p className="field__error" role="alert">{describeError(op.error, locale)}</p>}

              {(can.has('due') || can.has('priority')) && (
                <div className="tasks__controls">
                  {can.has('priority') && (
                    <label className="field">
                      <span className="field__label">{tx(C.manualLevel)}</span>
                      <SearchableSelect
                        clearable={false}
                        className="select"
                        value={t.manualPriority}
                        disabled={op.isPending}
                        onValueChange={(v) => {
                          const next = v as Level
                          op.mutate(() => tasksApi.setPriority(id, next))
                        }}
                      >
                        {LEVELS.map((l) => (
                          <option key={l} value={l}>{tx(LEVEL_LABEL[l])}</option>
                        ))}
                      </SearchableSelect>
                      {/* When something raised the level above the one a person set, say so: one level, explained. */}
                      {t.effectivePriority !== t.manualPriority && reasonOf(t, tx) && (
                        <span className="field__hint">{tx(C.levelNow, { level: tx(LEVEL_LABEL[t.effectivePriority]), reason: reasonOf(t, tx)! })}</span>
                      )}
                    </label>
                  )}
                  {can.has('due') && (
                    <DueControl
                      key={t.dueAt ?? 'none'}
                      date={due?.date ?? ''}
                      time={due?.time ?? ''}
                      disabled={op.isPending}
                      onSave={(iso) => op.mutate(() => tasksApi.setDue(id, iso))}
                    />
                  )}
                </div>
              )}

              {can.has('comment') && (
                <div className="tasks__comment">
                  <label className="field">
                    <span className="field__label">{tx(C.comment)}</span>
                    <textarea className="textarea" rows={2} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
                  </label>
                  <div>
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={!comment.trim() || op.isPending}
                      onClick={() => op.mutate(() => tasksApi.comment(id, comment.trim()), { onSuccess: () => setComment('') })}
                    >
                      {tx(C.send)}
                    </button>
                  </div>
                </div>
              )}

              <h3 className="tasks__history-title">{tx(C.history)}</h3>
              <History task={t} />
            </div>

            {(completes || secondary.length > 0) && (
              <footer className="insp__foot">
                <RowActions
                  label={tx(C.moreActions, { name: title(t) })}
                  primary={
                    can.has('complete') ? (
                      <button type="button" className="btn btn--primary" disabled={op.isPending} onClick={() => op.mutate(() => tasksApi.complete(id))}>
                        <Icon name="check" size={16} />
                        {tx(C.complete)}
                      </button>
                    ) : can.has('acknowledge') ? (
                      <button type="button" className="btn btn--primary" disabled={op.isPending} onClick={() => op.mutate(() => tasksApi.acknowledge(id))}>
                        <Icon name="check" size={16} />
                        {tx(C.acknowledge)}
                      </button>
                    ) : lead ? (
                      <button type="button" className={lead.danger ? 'btn btn--danger' : 'btn'} onClick={() => setDialog(lead.key)}>
                        {lead.label}
                      </button>
                    ) : undefined
                  }
                  more={rest.map((a) => ({ key: a.key, label: a.label, icon: a.icon, danger: a.danger, onSelect: () => setDialog(a.key) }))}
                />
              </footer>
            )}
          </>
        )}
      </QueryBoundary>
      {dialog === 'out_of_scope' && (
        <ReasonDialog
          title={tx(C.outOfScope)}
          label={tx(C.text)}
          confirmLabel={tx(C.send)}
          extra={<p className="field__hint">{tx(C.outOfScopeHint)}</p>}
          error={op.error}
          isPending={op.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(text) => op.mutate(() => tasksApi.outOfScope(id, text))}
        />
      )}
      {dialog === 'return' && (
        <ReasonDialog
          title={tx(C.returnTask)}
          label={tx(C.instructions)}
          confirmLabel={tx(C.send)}
          error={op.error}
          isPending={op.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(text) => op.mutate(() => tasksApi.returnTask(id, text))}
        />
      )}
      {dialog === 'remove' && (
        <ReasonDialog
          title={tx(C.remove)}
          label={tx(C.closeReason)}
          confirmLabel={tx(C.remove)}
          extra={<p className="field__hint">{tx(C.removeHint)}</p>}
          error={op.error}
          isPending={op.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(text) => op.mutate(() => tasksApi.remove(id, text))}
        />
      )}
      {dialog === 'reassign' && (
        <ReassignDialog
          taskId={id}
          error={op.error}
          isPending={op.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(to, instructions) => op.mutate(() => tasksApi.reassign(id, to, instructions))}
        />
      )}
    </section>
  )
}

/** Closes the inspector: a cross, with its name for whoever reads the text. */
function CloseButton({ onClose }: { onClose: () => void }) {
  const tx = useCopy()
  return (
    <button type="button" className="btn btn--ghost btn--icon btn--sm insp__close" title={tx(C.close)} onClick={onClose}>
      <Icon name="close" size={16} />
      <span className="sr-only">{tx(C.close)}</span>
    </button>
  )
}

function DueControl({ date, time, disabled, onSave }: { date: string; time: string; disabled: boolean; onSave: (iso: string | null) => void }) {
  const tx = useCopy()
  const [d, setD] = useState(date)
  const [h, setH] = useState(time || '17:00')
  const iso = d ? academyWallClockToIso(d, h || '00:00') : null
  return (
    <fieldset className="field">
      <legend className="field__label">{tx(C.dueAt)}</legend>
      <input className="input" type="date" aria-label={tx(C.dueAt)} value={d} disabled={disabled} onChange={(e) => setD(e.target.value)} />
      <input className="input" type="time" aria-label={tx({ en: 'Time', ar: 'الوقت' })} value={h} disabled={disabled || !d} onChange={(e) => setH(e.target.value)} />
      <div className="tasks__actions">
        <button type="button" className="btn" disabled={disabled || !iso || (d === date && h === time)} onClick={() => onSave(iso)}>
          {tx(C.save)}
        </button>
        {date && (
          <button type="button" className="btn btn--ghost" disabled={disabled} onClick={() => onSave(null)}>
            {tx(C.clearDue)}
          </button>
        )}
      </div>
    </fieldset>
  )
}

function History({ task }: { task: TaskDetail }) {
  const tx = useCopy()
  const when = useWhen()
  const { dir, locale } = useI18n()
  // "before → after" reads in the page's direction.
  const arrow = dir === 'rtl' ? '←' : '→'
  return (
    <ol className="tasks__history">
      {task.history.map((e) => {
        const before = e.before as Record<string, string | null> | null
        const after = e.after as Record<string, string | null> | null
        return (
          <li key={e.id}>
            <span>
              <strong>{tx(EVENT_LABEL[e.kind])}</strong>
              {e.kind === 'priority_changed' && before?.priority && after?.priority && (
                <>: {tx(LEVEL_LABEL[before.priority as Level])} {arrow} {tx(LEVEL_LABEL[after.priority as Level])}</>
              )}
              {e.kind === 'due_changed' && (
                <>: {before?.dueAt ? when(before.dueAt) : tx(C.noDue)} {arrow} {after?.dueAt ? when(after.dueAt) : tx(C.noDue)}</>
              )}
            </span>{' '}
            <span className="tasks__history-by">
              <span dir="auto">{e.actor ? e.actor.name : tx(C.system)}</span>
              {locale === 'ar' ? '، ' : ', '}
              <time dateTime={e.at}>{when(e.at)}</time>
            </span>
            {e.body && <p className="tasks__text" dir="auto">{e.body}</p>}
          </li>
        )
      })}
    </ol>
  )
}

function ReassignDialog({
  taskId,
  error,
  isPending,
  onClose,
  onConfirm,
}: {
  taskId: string
  error: unknown
  isPending: boolean
  onClose: () => void
  onConfirm: (to: Target, instructions?: string) => void
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const options = useQuery({ queryKey: keys.assignees(taskId), queryFn: () => tasksApi.assignees(taskId) })
  const [to, setTo] = useState('')
  const [instructions, setInstructions] = useState('')
  const target = (): Target | null => {
    const [kind, value] = to.split(':')
    if (kind === 'department') return { department: value as 'operations' | 'teachers' | 'sales' }
    if ((kind === 'staff' || kind === 'teacher') && value) return { kind, id: value }
    return null
  }
  return (
    <Dialog
      title={tx(C.reassign)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className="btn btn--primary"
            disabled={!target() || isPending}
            onClick={() => {
              const t = target()
              if (t) onConfirm(t, instructions.trim() || undefined)
            }}
          >
            {tx(C.reassign)}
          </button>
        </>
      }
    >
      <QueryBoundary isLoading={options.isLoading} error={options.error} onRetry={() => options.refetch()}>
        <label className="field">
          <span className="field__label">{tx(C.to)}</span>
          <SearchableSelect className="select" value={to} onValueChange={(v) => setTo(v)}>
            <option value="">{tx(C.choose)}</option>
            {(options.data?.departments ?? []).map((d) => (
              <option key={d.kind} value={`department:${d.kind}`}>
                {tx(C.department, { department: tx(DEPARTMENT_LABEL[d.kind]), name: d.managerName })}
              </option>
            ))}
            {(options.data?.people ?? []).map((p) => (
              <option key={`${p.kind}:${p.id}`} value={`${p.kind}:${p.id}`}>{p.name}</option>
            ))}
          </SearchableSelect>
        </label>
        {options.data?.truncated && <p className="field__hint" role="note">{tx(C.shortened)}</p>}
        <label className="field">
          <span className="field__label">{tx(C.optionalInstructions)}</span>
          <textarea className="textarea" rows={3} maxLength={2000} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </label>
      </QueryBoundary>
      {error != null && <p className="field__error" role="alert">{describeError(error, locale)}</p>}
    </Dialog>
  )
}

function NewTaskDialog({ onClose }: { onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const { staff } = useSession()
  const qc = useQueryClient()
  const options = useQuery({ queryKey: keys.assignees(), queryFn: () => tasksApi.assignees() })
  const [assignee, setAssignee] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('17:00')
  const [priority, setPriority] = useState<Level>('medium')
  const [financial, setFinancial] = useState(false)
  const create = useMutation({
    mutationFn: (input: NewTask) => tasksApi.create(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.all })
      onClose()
    },
  })
  const [kind, id] = assignee.split(':')
  const dueAt = date ? academyWallClockToIso(date, time || '00:00') : null
  const ready = (kind === 'staff' || kind === 'teacher') && !!id && title.trim().length > 0 && (!date || !!dueAt)
  // Owner Q-F3: a manager (or the super admin) may mark a task financial; the server decides.
  const mayMarkFinancial = holdsAny(staff, ['tasks.manage'])
  return (
    <Dialog
      title={tx(C.newTask)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className="btn btn--primary"
            disabled={!ready || create.isPending}
            onClick={() =>
              create.mutate({
                assignee: { kind: kind as 'staff' | 'teacher', id: id as string },
                title: title.trim(),
                ...(body.trim() ? { body: body.trim() } : {}),
                ...(dueAt ? { dueAt } : {}),
                priority,
                category: financial ? 'financial' : 'operational',
              })
            }
          >
            {tx(C.save)}
          </button>
        </>
      }
    >
      <QueryBoundary isLoading={options.isLoading} error={options.error} onRetry={() => options.refetch()}>
        <label className="field">
          <span className="field__label">{tx(C.taskTitle)}</span>
          <input className="input" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">{tx(C.assignee)}</span>
          <SearchableSelect className="select" value={assignee} onValueChange={(v) => setAssignee(v)}>
            <option value="">{tx(C.choose)}</option>
            {(options.data?.people ?? []).map((p) => (
              <option key={`${p.kind}:${p.id}`} value={`${p.kind}:${p.id}`}>{p.name}</option>
            ))}
          </SearchableSelect>
        </label>
        <label className="field">
          <span className="field__label">{tx(C.details)}</span>
          <textarea className="textarea" rows={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <div className="tasks__controls">
          <label className="field">
            <span className="field__label">{tx(C.dueAt)}</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">{tx({ en: 'Time', ar: 'الوقت' })}</span>
            <input className="input" type="time" value={time} disabled={!date} onChange={(e) => setTime(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">{tx(C.level)}</span>
            <SearchableSelect className="select" value={priority} onValueChange={(v) => setPriority(v as Level)}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>{tx(LEVEL_LABEL[l])}</option>
              ))}
            </SearchableSelect>
          </label>
        </div>
        {mayMarkFinancial && (
          <label className="tasks__check">
            <input type="checkbox" checked={financial} onChange={(e) => setFinancial(e.target.checked)} /> {tx(C.markFinancial)}
          </label>
        )}
      </QueryBoundary>
      {create.error != null && <p className="field__error" role="alert">{describeError(create.error, locale)}</p>}
    </Dialog>
  )
}
