import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { holdsAny } from '@/core/permissions/capabilities'
import { Badge } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { Icon, type IconName } from '@/shared/components/Icon'
import type { MenuItem } from '@/shared/components/Menu'
import { PageHeader, type MastFigure } from '@/shared/components/PageHeader'
import { RowActions } from '@/shared/components/RowActions'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { describeError } from '@/features/teacher-files/copy'
import { academyToday } from '@/features/schedule/viewState'
import { casesApi, type CaseDetail, type CaseStatus, type CaseSubjectKind, type CaseSummary, type CaseTab } from './api'
import { C, EVENT_LABEL, GROUP_LABEL, STATUS_LABEL, SUBJECT_LABEL, TAB_LABEL, TARGET_LABEL, useCopy } from './copy'
import { CASES_ACCESS_KEYS, TasksAreaTabs } from '@/features/tasks/TasksAreaTabs'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import '../teachers/teachers.css'
import './cases.css'

const TABS: CaseTab[] = ['mine', 'opened', 'department']
const keys = {
  list: (tab: CaseTab, closed: boolean) => ['cases', 'list', tab, closed] as const,
  one: (id: string) => ['cases', 'one', id] as const,
  owners: (id: string) => ['cases', 'owners', id] as const,
}

const STATUS_TONE: Record<CaseStatus, 'warn' | 'info' | 'ok' | 'neutral'> = {
  open: 'warn',
  in_progress: 'info',
  resolved: 'ok',
  cancelled: 'neutral',
}
const SUBJECT_ICON: Record<CaseSubjectKind, IconName> = {
  teacher: 'teachers',
  lesson: 'calendar',
  learner: 'students',
  complaint: 'alert',
  feedback: 'chatText',
}

/** Where a case stands in the queue: past its due day first, then not started, then being worked on. */
type Group = 'past' | 'open' | 'progress' | 'closed'
const GROUPS: Group[] = ['past', 'open', 'progress', 'closed']
const isLive = (c: Pick<CaseSummary, 'status'>) => c.status === 'open' || c.status === 'in_progress'
function groupOf(c: Pick<CaseSummary, 'status' | 'dueOn'>, today: string): Group {
  if (!isLive(c)) return 'closed'
  if (c.dueOn && c.dueOn.slice(0, 10) < today) return 'past'
  return c.status === 'open' ? 'open' : 'progress'
}

/** A case's due day ("2026-11-29") as a date in the viewer's language. */
function useDay() {
  const { date } = useI18n()
  return (day: string) => date(`${day.slice(0, 10)}T12:00:00Z`)
}

/**
 * PD-35 B5: the escalation-case queue. Mine (I own it), Opened by me, and My
 * department (cases sent to the department I manage). The server decides which
 * cases each tab holds and whether the caller may act (`canAct`); this page only
 * shows it. Reached from the Tasks page's Escalations tab (/cases); `header`
 * replaces the tab strip where another page hosts it.
 *
 * A queue and an inspector, as Tasks is: grouped by where each case stands (past
 * its due day first), the open case beside the list with its one action at the foot.
 */
export function CasesPage({ header }: { header?: React.ReactNode }) {
  const tx = useCopy()
  const { number } = useI18n()
  const { staff } = useSession()
  // A case card in a department room links here as /cases?case=<id>; a
  // Dashboard tile (PD-44) as /cases?tab=<tab>.
  const [params] = useSearchParams()
  const asked = params.get('tab')
  const [tab, setTab] = useState<CaseTab>(TABS.includes(asked as CaseTab) ? (asked as CaseTab) : 'mine')
  const [closed, setClosed] = useState(false)
  const [openId, setOpenId] = useState<string | null>(params.get('case'))
  const list = useQuery({
    queryKey: keys.list(tab, closed),
    queryFn: () => casesApi.list(tab, closed ? 'all' : 'open'),
    staleTime: 15_000,
  })
  const cases = list.data?.cases ?? []
  const today = academyToday()
  const grouped = GROUPS.map((g) => ({ group: g, rows: cases.filter((c) => groupOf(c, today) === g) })).filter((g) => g.rows.length > 0)
  const count = (g: Group) => cases.filter((c) => groupOf(c, today) === g).length

  // The figures are this view's own list, counted as it is grouped below.
  const figures: MastFigure[] = list.data
    ? [
        { key: 'past', label: tx(GROUP_LABEL.past), value: number(count('past')), tone: count('past') > 0 ? 'urgent' : 'quiet' },
        { key: 'open', label: tx(GROUP_LABEL.open), value: number(count('open')), tone: count('open') > 0 ? 'key' : 'quiet' },
        { key: 'progress', label: tx(GROUP_LABEL.progress), value: number(count('progress')) },
      ]
    : []
  const strip = header ?? (holdsAny(staff, CASES_ACCESS_KEYS) ? <TasksAreaTabs /> : undefined)

  return (
    <div className="page cases">
      <div className="page__inner">
        <PageHeader title={tx(C.title)} subtitle={tx(C.subtitle)} figures={figures} tabs={strip} />
        <div className={openId ? 'tq tq--open' : 'tq'}>
          <div className="sheet tq__sheet">
            <div className="sheet-bar cases__bar">
              <div role="tablist" className="ts-tabs" aria-label={tx(C.title)}>
                {TABS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    className={`ts-tab${tab === t ? ' ts-tab--active' : ''}`}
                    onClick={() => {
                      setTab(t)
                      setOpenId(null)
                    }}
                  >
                    {tx(TAB_LABEL[t])}
                  </button>
                ))}
              </div>
              <div className="sheet-bar__end">
                <label className="cases__closed">
                  <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> {tx(C.showClosed)}
                </label>
              </div>
            </div>
            <QueryBoundary isLoading={list.isLoading} error={list.error} onRetry={() => list.refetch()}>
              {cases.length === 0 ? (
                <EmptyState
                  title={tx(closed ? C.emptyAll : C.empty)}
                  hint={tx(C.emptyHint)}
                  action={
                    closed ? undefined : (
                      <button type="button" className="btn btn--sm" onClick={() => setClosed(true)}>
                        {tx(C.showClosed)}
                      </button>
                    )
                  }
                />
              ) : (
                grouped.map(({ group, rows }) => (
                  <section key={group} className={`tq-group tq-group--${group}`} aria-labelledby={`cases-group-${group}`}>
                    <h2 className="tq-group__head" id={`cases-group-${group}`}>
                      <span>{tx(GROUP_LABEL[group])}</span>
                      <span className={group === 'past' ? 'count count--urgent' : 'count count--quiet'}>{number(rows.length)}</span>
                    </h2>
                    <ul className="tq-rows">
                      {rows.map((c) => (
                        <CaseRow key={c.id} c={c} late={group === 'past'} selected={c.id === openId} onOpen={() => setOpenId(c.id)} />
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </QueryBoundary>
          </div>
          {openId && <CasePanel key={openId} id={openId} onClose={() => setOpenId(null)} />}
        </div>
      </div>
    </div>
  )
}

function CaseRow({ c, late, selected, onOpen }: { c: CaseSummary; late: boolean; selected: boolean; onOpen: () => void }) {
  const tx = useCopy()
  const day = useDay()
  return (
    <li className={`tq-row tq-row--case${selected ? ' tq-row--selected' : ''}${late ? ' tq-row--late' : ''}`}>
      <div className="tq-row__main">
        <button type="button" className="cases__title" dir="auto" aria-current={selected ? 'true' : undefined} onClick={onOpen}>
          {c.title}
        </button>
        <div className="tq-row__sub">
          <span className="cases__about">
            <Icon name={SUBJECT_ICON[c.subject.kind]} size={14} />
            <span>{tx(SUBJECT_LABEL[c.subject.kind])}:</span> <bdi>{c.subject.label}</bdi>
          </span>
          <span>{c.owner ? <bdi>{c.owner.name}</bdi> : tx(C.noOwner)}</span>
        </div>
      </div>
      <div className="tq-row__when">
        {c.dueOn ? (
          <>
            <span className="tq-row__age">{late ? tx(C.pastDue) : tx(C.dueOn, { date: day(c.dueOn) })}</span>
            {late && <span className="tq-row__date">{tx(C.dueOn, { date: day(c.dueOn) })}</span>}
          </>
        ) : (
          <span className="tq-row__date">{tx(C.noDue)}</span>
        )}
      </div>
      <div className="tq-row__level">
        <Badge tone={STATUS_TONE[c.status]}>{tx(STATUS_LABEL[c.status])}</Badge>
      </div>
    </li>
  )
}

function CasePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const day = useDay()
  const qc = useQueryClient()
  const one = useQuery({ queryKey: keys.one(id), queryFn: () => casesApi.get(id) })
  const c = one.data
  const owners = useQuery({ queryKey: keys.owners(id), queryFn: () => casesApi.owners(id), enabled: !!c?.canAct })
  const [closing, setClosing] = useState<'resolved' | 'cancelled' | null>(null)
  const [noting, setNoting] = useState(false)
  const done = (next: CaseDetail) => {
    qc.setQueryData(keys.one(id), next)
    void qc.invalidateQueries({ queryKey: ['cases', 'list'] })
  }
  const op = useMutation({ mutationFn: (fn: () => Promise<CaseDetail>) => fn(), onSuccess: done })
  const live = !!c && isLive(c)
  // Named after the case once what it shows has arrived (the owners list too, for someone who acts).
  const ready = !!c && (!c.canAct || owners.isFetched)
  // One stated action (Resolve while the case is live); the rest behind "⋯".
  const more: MenuItem[] = c?.canAct
    ? [
        ...(live && c.status === 'open'
          ? [{ key: 'start', label: tx(C.start), icon: 'play' as const, onSelect: () => op.mutate(() => casesApi.setStatus(id, 'in_progress')) }]
          : []),
        ...(live ? [{ key: 'note', label: tx(C.addNote), icon: 'note' as const, onSelect: () => setNoting(true) }] : []),
        ...(live ? [{ key: 'cancel', label: tx(C.cancel), icon: 'xCircle' as const, danger: true, onSelect: () => setClosing('cancelled') }] : []),
      ]
    : []

  return (
    <section className="cases__panel sheet insp" aria-label={ready && c ? c.title : tx(C.title)}>
      <QueryBoundary isLoading={one.isLoading} error={one.error} onRetry={() => one.refetch()}>
        {c && (
          <>
            <header className="insp__head">
              <div className="insp__top">
                <span className="insp__kind">
                  <Icon name={SUBJECT_ICON[c.subject.kind]} size={16} />
                  {tx(SUBJECT_LABEL[c.subject.kind])}
                </span>
                <button type="button" className="btn btn--ghost btn--icon btn--sm insp__close" title={tx(C.close)} onClick={onClose}>
                  <Icon name="close" size={16} />
                  <span className="sr-only">{tx(C.close)}</span>
                </button>
              </div>
              <h2 className="cases__panel-title" dir="auto">{c.title}</h2>
              <div className="tasks__chips">
                <Badge tone={STATUS_TONE[c.status]}>{tx(STATUS_LABEL[c.status])}</Badge>
              </div>
            </header>

            <div className="insp__body">
              <dl className="insp__facts">
                <div>
                  <dt>{tx(C.about)}</dt>
                  <dd><bdi>{c.subject.label}</bdi></dd>
                </div>
                <div>
                  <dt>{tx(C.factOpenedBy)}</dt>
                  <dd><bdi>{c.openedBy.name}</bdi></dd>
                </div>
                <div>
                  <dt>{tx(C.sendTo)}</dt>
                  <dd>{tx(TARGET_LABEL[c.target])}</dd>
                </div>
                {!c.canAct && (
                  <>
                    <div>
                      <dt>{tx(C.owner)}</dt>
                      <dd>{c.owner ? <bdi>{c.owner.name}</bdi> : tx(C.noOwner)}</dd>
                    </div>
                    <div>
                      <dt>{tx(C.due)}</dt>
                      <dd>{c.dueOn ? day(c.dueOn) : tx(C.noDue)}</dd>
                    </div>
                  </>
                )}
              </dl>
              {c.body && <p className="cases__text" dir="auto">{c.body}</p>}
              {op.error && <p className="field__error" role="alert">{describeError(op.error, locale)}</p>}

              {c.canAct && (
                <div className="cases__controls">
                  <label className="field">
                    <span className="field__label">{tx(C.owner)}</span>
                    <SearchableSelect
                      clearable={false}
                      className="select"
                      aria-label={tx(C.owner)}
                      value={c.owner?.id ?? ''}
                      disabled={!live || op.isPending}
                      onValueChange={(v) => {
                        const ownerId = v
                        if (ownerId) op.mutate(() => casesApi.assign(id, ownerId))
                      }}
                    >
                      {!c.owner && <option value="">{tx(C.noOwner)}</option>}
                      {(owners.data?.owners ?? (c.owner ? [c.owner] : [])).map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </SearchableSelect>
                  </label>
                  <label className="field">
                    <span className="field__label">{tx(C.due)}</span>
                    <input
                      className="input"
                      type="date"
                      aria-label={tx(C.due)}
                      value={c.dueOn ?? ''}
                      disabled={!live || op.isPending}
                      onChange={(e) => {
                        const dueOn = e.target.value || null
                        op.mutate(() => casesApi.setDue(id, dueOn))
                      }}
                    />
                  </label>
                </div>
              )}

              <h3 className="cases__history-title">{tx(C.history)}</h3>
              <ol className="cases__history">
                {c.events.map((e) => (
                  <li key={e.id}>
                    <strong>{tx(EVENT_LABEL[e.kind])}</strong>
                    {e.kind === 'status' && e.after?.status ? <> — {tx(STATUS_LABEL[e.after.status as CaseStatus])}</> : null}
                    <span className="cases__history-by">
                      {' · '}
                      <bdi>{e.actor.name}</bdi> · <time dateTime={e.at}>{dateTime(e.at)}</time>
                    </span>
                    {e.note && <p className="cases__text" dir="auto">{e.note}</p>}
                  </li>
                ))}
              </ol>
            </div>

            {c.canAct && (
              <footer className="insp__foot">
                <RowActions
                  label={tx(C.moreActions, { name: c.title })}
                  primary={
                    live ? (
                      <button type="button" className="btn btn--primary" onClick={() => setClosing('resolved')}>
                        <Icon name="check" size={16} />
                        {tx(C.resolve)}
                      </button>
                    ) : (
                      <button type="button" className="btn" onClick={() => setNoting(true)}>
                        {tx(C.addNote)}
                      </button>
                    )
                  }
                  more={more}
                />
              </footer>
            )}
          </>
        )}
      </QueryBoundary>
      {closing && (
        <NoteDialog
          title={tx(closing === 'resolved' ? C.resolve : C.cancel)}
          hint={tx(C.noteHint)}
          onClose={() => setClosing(null)}
          onSave={(note) => op.mutate(() => casesApi.setStatus(id, closing, note), { onSuccess: () => setClosing(null) })}
        />
      )}
      {noting && (
        <NoteDialog
          title={tx(C.addNote)}
          onClose={() => setNoting(false)}
          onSave={(note) => op.mutate(() => casesApi.note(id, note), { onSuccess: () => setNoting(false) })}
        />
      )}
    </section>
  )
}

function NoteDialog({ title, hint, onClose, onSave }: { title: string; hint?: string; onClose: () => void; onSave: (note: string) => void }) {
  const tx = useCopy()
  const [note, setNote] = useState('')
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={!note.trim()} onClick={() => onSave(note.trim())}>
            {tx(C.save)}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">{tx(C.note)}</span>
        <textarea className="input" rows={4} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {hint && <p className="field__hint">{hint}</p>}
    </Dialog>
  )
}
