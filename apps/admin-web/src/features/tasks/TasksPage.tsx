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
import { ReasonDialog } from '@/shared/components/ReasonDialog'
import { QueryBoundary } from '@/shared/components/States'
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
import { C, DEPARTMENT_LABEL, EVENT_LABEL, LEVEL_LABEL, SOURCE_LABEL, STATE_LABEL, TAB_LABEL, useCopy } from './copy'
import { sourceLink, stateOf, STATE_TONE, titleOf } from './format'
import { FinanceTag, PriorityChip } from './PriorityChip'
import './tasks.css'

type Tab = TaskView | 'closed'
const LEVELS: Level[] = ['high', 'medium', 'low']

const keys = {
  all: ['tasks'] as const,
  list: (q: ListQuery) => ['tasks', 'list', q] as const,
  one: (id: string) => ['tasks', 'one', id] as const,
  assignees: (taskId?: string) => ['tasks', 'assignees', taskId ?? null] as const,
}

/** "3 Nov, 6:00 PM": an instant on the academy's clock, 12-hour (PD-22, owner 2026-10-28). */
function useWhen() {
  const { locale } = useI18n()
  return (iso: string) => `${dayMonthIn(iso, ACADEMY_ZONE, locale)}, ${clock12In(iso, ACADEMY_ZONE, locale)}`
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

/**
 * PD-47: one Tasks page for every staff member. Mine, the team's (read-only
 * for a teacher's supervisor), the decisions waiting on the viewer, everything
 * (the super admin), and the closed ones with their history. Most urgent first,
 * in the server's order; nothing here decides who sees or may do what.
 *
 * Deep links: ?tab=, ?task=<id>, ?overdue=true, ?level=, ?category=.
 */
export function TasksPage({ eyebrow }: { eyebrow?: string }) {
  const tx = useCopy()
  const { staff } = useSession()
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
  const [openId, setOpenId] = useState<string | null>(params.get('task'))
  const [creating, setCreating] = useState(false)
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
    if (openId) next.set('task', openId)
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }, [tab, level, category, overdue, openId, params, setParams])

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
    }),
    [tab, closedView, level, category, overdue],
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

  return (
    <div className="page tasks">
      <PageHeader
        eyebrow={eyebrow}
        title={tx(C.title)}
        subtitle={tx(C.subtitle)}
        actions={
          canCreate ? (
            <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
              {tx(C.newTask)}
            </button>
          ) : undefined
        }
      />
      <div className="tasks__bar">
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
        <div className="tasks__filters">
          {tab === 'closed' && closedViews.length > 1 && (
            <select className="select" aria-label={tx(C.whose)} value={closedView} onChange={(e) => setClosedView(e.target.value as TaskView)}>
              {closedViews.map((v) => (
                <option key={v} value={v}>{tx(TAB_LABEL[v])}</option>
              ))}
            </select>
          )}
          <select className="select" aria-label={tx(C.level)} value={level} onChange={(e) => setLevel(e.target.value as Level | '')}>
            <option value="">{tx(C.anyLevel)}</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>{tx(LEVEL_LABEL[l])}</option>
            ))}
          </select>
          <select className="select" aria-label={tx(C.kind)} value={category} onChange={(e) => setCategory(e.target.value as Category | '')}>
            <option value="">{tx(C.anyKind)}</option>
            <option value="financial">{tx({ en: 'Finance', ar: 'مالية' })}</option>
            <option value="operational">{tx(C.operational)}</option>
          </select>
          {tab !== 'closed' && (
            <label className="tasks__check">
              <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> {tx(C.overdueOnly)}
            </label>
          )}
        </div>
      </div>
      <div className="tasks__body">
        <div id="tasks-tabpanel" role="tabpanel" aria-labelledby={`tasks-tab-${tab}`}>
          <QueryBoundary isLoading={list.isLoading} error={list.error} isEmpty={items.length === 0} emptyTitle={tx(C.empty)} onRetry={() => list.refetch()}>
            <ul className="tasks__list">
              {items.map((t) => (
                <TaskRow key={t.id} task={t} showAssignee={query.view !== 'mine'} selected={t.id === openId} onOpen={() => setOpenId(t.id)} />
              ))}
            </ul>
            {list.hasNextPage && (
              <button type="button" className="btn tasks__more" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {tx(C.loadMore)}
              </button>
            )}
          </QueryBoundary>
        </div>
        {/* Keyed by the task: a draft, a dialog or a date typed for one task never carries to the next. */}
        {openId && <TaskPanel key={openId} id={openId} onClose={() => setOpenId(null)} />}
      </div>
      {creating && <NewTaskDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

/** Overdue in words and an icon, never by colour alone. */
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
  const { duration } = useI18n()
  const when = useWhen()
  const title = useTitle()
  const state = stateOf(task)
  const closed = task.state === 'completed' || task.state === 'removed'
  return (
    <li className={`tasks__row${selected ? ' tasks__row--selected' : ''}`}>
      <button type="button" className="tasks__title" dir="auto" aria-current={selected ? 'true' : undefined} onClick={onOpen}>
        {title(task)}
      </button>
      <div className="tasks__chips">
        {!closed && <PriorityChip task={task} />}
        {task.category === 'financial' && <FinanceTag />}
        <Badge tone={STATE_TONE[state]}>{tx(STATE_LABEL[state])}</Badge>
        <Badge tone="outline">{tx(SOURCE_LABEL[task.source?.type ?? 'manual'])}</Badge>
        {task.needsReassignment && !closed && <Badge tone="danger">{tx(C.assigneeLeft)}</Badge>}
      </div>
      <div className="tasks__meta">
        {showAssignee && <span dir="auto">{tx(C.assignedTo, { name: task.assigneeName })}</span>}
        {closed ? (
          task.closedAt && <span>{tx(C.closedOn, { when: when(task.closedAt) })}</span>
        ) : (
          <>
            <span>{task.dueAt ? tx(C.due, { when: when(task.dueAt) }) : tx(C.noDue)}</span>
            {task.overdue && <OverdueMark />}
            <span>· {tx(C.age, { ago: duration(task.createdAt) })}</span>
          </>
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
      <section className="tasks__panel card" aria-label={tx(C.title)}>
        <div className="tasks__panel-head">
          <p className="tasks__text" role="status">{tx(C.notFound)}</p>
          <button type="button" className="btn btn--ghost" onClick={onClose}>{tx(C.close)}</button>
        </div>
      </section>
    )
  }

  return (
    <section className="tasks__panel card" aria-label={t ? title(t) : tx(C.title)}>
      <QueryBoundary isLoading={one.isLoading} error={one.error} onRetry={() => one.refetch()}>
        {t && (
          <>
            <div className="tasks__panel-head">
              <h2 className="tasks__panel-title" dir="auto">{title(t)}</h2>
              <button type="button" className="btn btn--ghost" onClick={onClose}>{tx(C.close)}</button>
            </div>
            <div className="tasks__chips">
              {t.state !== 'completed' && t.state !== 'removed' && <PriorityChip task={t} />}
              {t.category === 'financial' && <FinanceTag />}
              <Badge tone={STATE_TONE[state]}>{tx(STATE_LABEL[state])}</Badge>
              <Badge tone="outline">{tx(SOURCE_LABEL[t.source?.type ?? 'manual'])}</Badge>
            </div>
            <p className="tasks__meta">
              <span dir="auto">{tx(C.assignedTo, { name: t.assigneeName })}</span>
              {t.createdBy && <span dir="auto">· {tx(C.createdBy, { name: t.createdBy.name })}</span>}
              <span>· {t.dueAt ? tx(C.due, { when: when(t.dueAt) }) : tx(C.noDue)}</span>
              {t.overdue && t.state !== 'completed' && t.state !== 'removed' && <OverdueMark />}
            </p>
            {link && (
              <p>
                <Link className="btn" to={link}>{tx(C.openSource)}</Link>
              </p>
            )}
            {t.instructions && t.state === 'open' && (
              <div className="tasks__banner" role="note">
                <p className="tasks__banner-title">{tx(C.instructions)}</p>
                <p className="tasks__text" dir="auto">{t.instructions}</p>
              </div>
            )}
            {t.sourceState === 'withdrawn' && t.state !== 'completed' && t.state !== 'removed' && (
              <div className="tasks__banner" role="note">{tx(C.withdrawn)}</div>
            )}
            {t.needsReassignment && <div className="tasks__banner" role="note">{tx(C.assigneeLeft)}</div>}
            {t.unmanaged && <div className="tasks__banner" role="note">{tx(C.unmanaged)}</div>}
            {t.body && <p className="tasks__text" dir="auto">{t.body}</p>}
            {t.closeReason && (
              <p className="tasks__text" dir="auto">
                <strong>{tx(C.closeReason)}:</strong> {t.closeReason}
              </p>
            )}
            {op.error && <p className="field__error" role="alert">{describeError(op.error, locale)}</p>}

            <div className="tasks__actions">
              {can.has('complete') && (
                <button type="button" className="btn btn--primary" disabled={op.isPending} onClick={() => op.mutate(() => tasksApi.complete(id))}>
                  {tx(C.complete)}
                </button>
              )}
              {can.has('acknowledge') && (
                <button type="button" className="btn btn--primary" disabled={op.isPending} onClick={() => op.mutate(() => tasksApi.acknowledge(id))}>
                  {tx(C.acknowledge)}
                </button>
              )}
              {can.has('out_of_scope') && <button type="button" className="btn" onClick={() => setDialog('out_of_scope')}>{tx(C.outOfScope)}</button>}
              {can.has('return') && <button type="button" className="btn" onClick={() => setDialog('return')}>{tx(C.returnTask)}</button>}
              {can.has('reassign') && <button type="button" className="btn" onClick={() => setDialog('reassign')}>{tx(C.reassign)}</button>}
              {can.has('remove') && <button type="button" className="btn" onClick={() => setDialog('remove')}>{tx(C.remove)}</button>}
            </div>

            {(can.has('due') || can.has('priority')) && (
              <div className="tasks__controls">
                {can.has('priority') && (
                  <label className="field">
                    <span className="field__label">{tx(C.manualLevel)}</span>
                    <select
                      className="select"
                      value={t.manualPriority}
                      disabled={op.isPending}
                      onChange={(e) => {
                        const next = e.target.value as Level
                        op.mutate(() => tasksApi.setPriority(id, next))
                      }}
                    >
                      {LEVELS.map((l) => (
                        <option key={l} value={l}>{tx(LEVEL_LABEL[l])}</option>
                      ))}
                    </select>
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
                    className="btn"
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
  // "before → after" reads in the page's direction.
  const arrow = useI18n().dir === 'rtl' ? '←' : '→'
  return (
    <ol className="tasks__history">
      {task.history.map((e) => {
        const before = e.before as Record<string, string | null> | null
        const after = e.after as Record<string, string | null> | null
        return (
          <li key={e.id}>
            <strong>{tx(EVENT_LABEL[e.kind])}</strong>
            {e.kind === 'priority_changed' && before?.priority && after?.priority && (
              <> — {tx(LEVEL_LABEL[before.priority as Level])} {arrow} {tx(LEVEL_LABEL[after.priority as Level])}</>
            )}
            {e.kind === 'due_changed' && (
              <> — {before?.dueAt ? when(before.dueAt) : tx(C.noDue)} {arrow} {after?.dueAt ? when(after.dueAt) : tx(C.noDue)}</>
            )}
            {' · '}
            <span dir="auto">{e.actor ? e.actor.name : tx(C.system)}</span> · <time dateTime={e.at}>{when(e.at)}</time>
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
          <select className="select" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">{tx(C.choose)}</option>
            {(options.data?.departments ?? []).map((d) => (
              <option key={d.kind} value={`department:${d.kind}`}>
                {tx(C.department, { department: tx(DEPARTMENT_LABEL[d.kind]), name: d.managerName })}
              </option>
            ))}
            {(options.data?.people ?? []).map((p) => (
              <option key={`${p.kind}:${p.id}`} value={`${p.kind}:${p.id}`}>{p.name}</option>
            ))}
          </select>
        </label>
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
          <span className="field__label">{tx(C.assignee)}</span>
          <select className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">{tx(C.choose)}</option>
            {(options.data?.people ?? []).map((p) => (
              <option key={`${p.kind}:${p.id}`} value={`${p.kind}:${p.id}`}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{tx(C.taskTitle)}</span>
          <input className="input" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
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
            <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as Level)}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>{tx(LEVEL_LABEL[l])}</option>
              ))}
            </select>
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
