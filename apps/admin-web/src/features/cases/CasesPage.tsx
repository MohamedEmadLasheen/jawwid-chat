import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { QueryBoundary } from '@/shared/components/States'
import { describeError } from '@/features/teacher-files/copy'
import { casesApi, type CaseDetail, type CaseStatus, type CaseSummary, type CaseTab } from './api'
import { C, EVENT_LABEL, STATUS_LABEL, SUBJECT_LABEL, TAB_LABEL, TARGET_LABEL, useCopy } from './copy'
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

/**
 * PD-35 B5: the escalation-case queue. Mine (I own it), Opened by me, and My
 * department (cases sent to the department I manage). The server decides which
 * cases each tab holds and whether the caller may act (`canAct`); this page only
 * shows it. Rendered in the Teachers area (`header`) and on /cases.
 */
export function CasesPage({ header }: { header?: React.ReactNode }) {
  const tx = useCopy()
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

  return (
    <div className="page cases">
      {header}
      <header className="page__header">
        <h1 className="page__title">{tx(C.title)}</h1>
        <p className="page__subtitle">{tx(C.subtitle)}</p>
      </header>
      <div className="cases__bar">
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
        <label className="cases__closed">
          <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> {tx(C.showClosed)}
        </label>
      </div>
      <div className="cases__body">
        <QueryBoundary isLoading={list.isLoading} error={list.error} isEmpty={cases.length === 0} emptyTitle={tx(C.empty)} onRetry={() => list.refetch()}>
          <ul className="cases__list">
            {cases.map((c) => (
              <CaseRow key={c.id} c={c} selected={c.id === openId} onOpen={() => setOpenId(c.id)} />
            ))}
          </ul>
        </QueryBoundary>
        {openId && <CasePanel id={openId} onClose={() => setOpenId(null)} />}
      </div>
    </div>
  )
}

function CaseRow({ c, selected, onOpen }: { c: CaseSummary; selected: boolean; onOpen: () => void }) {
  const tx = useCopy()
  return (
    <li className={`cases__row${selected ? ' cases__row--selected' : ''}`}>
      <button type="button" className="cases__title" onClick={onOpen}>
        {c.title}
      </button>
      <div className="cases__meta">
        <Badge tone={STATUS_TONE[c.status]}>{tx(STATUS_LABEL[c.status])}</Badge>
        <span>{tx(SUBJECT_LABEL[c.subject.kind])}:</span> <span dir="auto">{c.subject.label}</span>
        <span>· {c.owner ? c.owner.name : tx(C.noOwner)}</span>
        {c.dueOn && <span>· {tx(C.dueOn, { date: c.dueOn })}</span>}
      </div>
    </li>
  )
}

function CasePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
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
  const live = c && (c.status === 'open' || c.status === 'in_progress')
  // Named after the case once what it shows has arrived (the owners list too, for someone who acts).
  const ready = !!c && (!c.canAct || owners.isFetched)

  return (
    <section className="cases__panel card" aria-label={ready && c ? c.title : tx(C.title)}>
      <QueryBoundary isLoading={one.isLoading} error={one.error} onRetry={() => one.refetch()}>
        {c && (
          <>
            <div className="cases__panel-head">
              <h2 className="cases__panel-title" dir="auto">{c.title}</h2>
              <button type="button" className="btn btn--ghost" onClick={onClose}>{tx(C.close)}</button>
            </div>
            <p className="cases__meta">
              <Badge tone={STATUS_TONE[c.status]}>{tx(STATUS_LABEL[c.status])}</Badge>{' '}
              {tx(C.openedBy, { name: c.openedBy.name })} · {tx(TARGET_LABEL[c.target])}
            </p>
            <p className="cases__meta">
              {tx(C.about)}: {tx(SUBJECT_LABEL[c.subject.kind])} — <span dir="auto">{c.subject.label}</span>
            </p>
            {c.body && <p className="cases__text" dir="auto">{c.body}</p>}
            {op.error && <p className="field__error" role="alert">{describeError(op.error, locale)}</p>}

            {c.canAct ? (
              <div className="cases__controls">
                <label className="field">
                  <span className="field__label">{tx(C.owner)}</span>
                  <select
                    className="select"
                    aria-label={tx(C.owner)}
                    value={c.owner?.id ?? ''}
                    disabled={!live || op.isPending}
                    onChange={(e) => {
                      const ownerId = e.target.value
                      if (ownerId) op.mutate(() => casesApi.assign(id, ownerId))
                    }}
                  >
                    {!c.owner && <option value="">{tx(C.noOwner)}</option>}
                    {(owners.data?.owners ?? (c.owner ? [c.owner] : [])).map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
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
                {live && (
                  <div className="cases__actions">
                    {c.status === 'open' && (
                      <button type="button" className="btn" disabled={op.isPending} onClick={() => op.mutate(() => casesApi.setStatus(id, 'in_progress'))}>
                        {tx(C.start)}
                      </button>
                    )}
                    <button type="button" className="btn btn--primary" onClick={() => setClosing('resolved')}>{tx(C.resolve)}</button>
                    <button type="button" className="btn" onClick={() => setClosing('cancelled')}>{tx(C.cancel)}</button>
                  </div>
                )}
                <button type="button" className="btn btn--ghost" onClick={() => setNoting(true)}>{tx(C.addNote)}</button>
              </div>
            ) : (
              <p className="cases__meta">
                {tx(C.owner)}: {c.owner?.name ?? tx(C.noOwner)} · {c.dueOn ? tx(C.dueOn, { date: c.dueOn }) : tx(C.noDue)}
              </p>
            )}

            <h3 className="cases__history-title">{tx(C.history)}</h3>
            <ol className="cases__history">
              {c.events.map((e) => (
                <li key={e.id}>
                  <strong>{tx(EVENT_LABEL[e.kind])}</strong>
                  {e.kind === 'status' && e.after?.status ? <> — {tx(STATUS_LABEL[e.after.status as CaseStatus])}</> : null}
                  {' · '}
                  {e.actor.name} · <time dateTime={e.at}>{new Date(e.at).toLocaleString(locale === 'ar' ? 'ar' : 'en-GB')}</time>
                  {e.note && <p className="cases__text" dir="auto">{e.note}</p>}
                </li>
              ))}
            </ol>
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
