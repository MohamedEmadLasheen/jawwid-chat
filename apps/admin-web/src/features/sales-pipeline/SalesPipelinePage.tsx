import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { Age, Board, BoardCard, RequestQueue, dayName, sentence, type BoardStage } from '@/shared/components/RequestQueue'
import { RowActions } from '@/shared/components/RowActions'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { STAGES, type ContactPresence, type LeadDetail, type LeadRow, type Stage } from './api'
import { CreateLeadDialog } from './CreateLeadDialog'
import { LeadPanel } from './LeadDetail'
import { P, STAGE, lostText } from './copy'
import { ForbiddenPage } from '@/app/ForbiddenPage'
import { ApiError } from '@/core/api/errors'
import { useLeads, usePipelineAccess } from './hooks'
import '../teachers/teachers.css'
import '../trials/trials.css'
import '../trials/new-students.css'
import './sales-pipeline.css'

const PAGE_SIZE = 25
type StageFilter = Stage | 'all'

/** A search that waits for a pause in typing, so each key is not a request. */
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * The Sales pipeline (PD-59): leads from the first call to the hand-over, as a
 * board with one column per stage (each headed by the server's count). A lead
 * is a trial prospect; Trial booked, Trial completed, Converted and a trial's
 * Lost come from the trial itself. A card says whether a channel is on file,
 * never the contact: that arrives with the lead's own inspector, and is
 * audited -- so the inspector is there only while a lead is open, never by
 * itself. The server decides who may open any of it.
 *
 * The board is the page's one read, as before: the newest leads across every
 * stage. A stage with more leads than that read brought says so and opens by
 * itself, as the server's filtered, paged list.
 */
export function SalesPipelinePage() {
  const { locale, number } = useI18n()
  const tx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const [stage, setStage] = useState<StageFilter>('all')
  const [search, setSearch] = useState('')
  const [due, setDue] = useState(false)
  const [offset, setOffset] = useState(0)
  // The Requests hub links here with the lead to open (?open=<id>): opening it is the one audited read.
  const [params] = useSearchParams()
  const [openId, setOpenId] = useState<string | null>(() => params.get('open'))
  const [creating, setCreating] = useState(false)
  const q = useDebounced(search.trim())
  // The server decides who may open the pipeline. An account it refuses (a Teachers or
  // Finance account that typed the address) gets the Forbidden page, not the page's frame.
  const access = usePipelineAccess()
  const refused = access.data?.allowed === false || (access.error instanceof ApiError && access.error.status === 403)

  const list = useLeads({ stage: stage === 'all' ? '' : stage, q, followUp: due ? 'due' : '', limit: PAGE_SIZE, offset })
  useEffect(() => setOffset(0), [stage, q, due])
  // The open lead, as its inspector read it (the one audited read of the contact happens there, on opening).
  const [loaded, setLoaded] = useState<LeadDetail | null>(null)
  const lead = loaded && loaded.id === openId ? loaded : null

  if (refused) return <ForbiddenPage />

  const data = list.data
  const counts = data?.counts
  const total = counts ? STAGES.reduce((n, s) => n + counts[s], 0) : null
  const rows = data?.leads ?? []
  const last = data ? Math.min(data.offset + rows.length, data.total) : 0
  const openRow = rows.find((r) => r.id === openId)

  const stages: Array<BoardStage<Stage>> = STAGES.map((s) => {
    const mine = rows.filter((r) => r.stage === s)
    const count = counts ? counts[s] : null
    // With a search or the follow-up filter on, the server's stage counts no longer describe what is shown.
    const narrowed = !!q || due
    const hidden = stage === 'all' && !narrowed && count !== null ? count - mine.length : 0
    return {
      key: s,
      label: tx(STAGE[s].label),
      count: narrowed ? mine.length : count,
      // Where the work has ended: a narrower column of quieter cards.
      quiet: s === 'converted' || s === 'lost',
      cards: mine.map((r) => <LeadCard key={r.id} row={r} selected={r.id === openId} onOpen={() => setOpenId(r.id)} />),
      empty: tx(P.stageEmpty),
      foot:
        hidden > 0 ? (
          <button type="button" className="btn btn--sm btn--ghost rq-col__foot" onClick={() => setStage(s)}>
            {tx(P.showAll).replace('{n}', number(count!))}
          </button>
        ) : undefined,
    }
  })

  return (
    <div className="page rq-page">
      <div className="page__inner">
        <PageHeader
          title={tx(P.title)}
          actions={
            <button type="button" className="btn" onClick={() => setCreating(true)}>
              <Icon name="plus" size={16} />
              {tx(P.newLead)}
            </button>
          }
        />
        <RequestQueue
          label={tx(P.panelLabel)}
          detail={
            openId
              ? {
                  id: openId,
                  title: lead?.displayName ?? openRow?.displayName ?? tx(P.lead),
                  kind: { icon: 'pipeline', label: tx(P.kind) },
                  onClose: () => setOpenId(null),
                  body: <LeadPanel id={openId} onLead={setLoaded} />,
                }
              : null
          }
        >
          <div className="rq-bar lead-bar">
            <label className="search">
              <Icon name="search" size={16} />
              <span className="sr-only">{tx(P.search)}</span>
              <input className="input" type="search" value={search} placeholder={tx(P.search)} aria-describedby="sp-search-hint" onChange={(e) => setSearch(e.target.value)} />
            </label>
            <span id="sp-search-hint" className="lead-bar__hint" title={tx(P.searchHint)}>{tx(P.searchHint)}</span>
            <div className="rq-bar__end">
              {stage !== 'all' && (
                <button type="button" className="chip" onClick={() => setStage('all')}>{tx(P.allStages)}</button>
              )}
              {/* Not a stage: the leads whose follow-up date has passed, across every stage. */}
              <button type="button" className="chip" aria-pressed={due} onClick={() => setDue((d) => !d)}>
                {tx(P.followUpDue)}
                {data && <span className={data.dueCount > 0 ? 'count count--urgent' : 'chip__count'}>{number(data.dueCount)}</span>}
              </button>
            </div>
          </div>
          <QueryBoundary isLoading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            {rows.length === 0 && (total === 0 || !!q || due) ? (
              <div className="sheet rq-blank">
                <EmptyState title={total === 0 && stage === 'all' && !q && !due ? tx(P.empty) : tx(P.noMatch)} />
              </div>
            ) : (
              <>
                <Board label={tx(P.filterLabel)} stages={stages} value={stage} onChange={setStage} />
                {/* One page needs no pager. */}
                {data && stage !== 'all' && data.total > rows.length && (
                  <div className="lead-pager">
                    <span className="ts-muted ltr">{number(data.offset + 1)}–{number(last)} / {number(data.total)}</span>
                    <button type="button" className="btn btn--sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>{tx(P.previous)}</button>
                    <button type="button" className="btn btn--sm" disabled={last >= data.total} onClick={() => setOffset(offset + PAGE_SIZE)}>{tx(P.next)}</button>
                  </div>
                )}
                {data?.truncated && <p className="field__hint">{tx(P.truncated)}</p>}
              </>
            )}
          </QueryBoundary>
        </RequestQueue>
        {creating && <CreateLeadDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id) }} />}
      </div>
    </div>
  )
}

function channelsText(c: ContactPresence, tx: (p: { en: string; ar: string }) => string, locale: 'ar' | 'en'): string {
  const on = [c.phone && tx(P.phone), c.whatsapp && tx(P.whatsapp), c.email && tx(P.email)].filter(Boolean)
  return on.length > 0 ? on.join(locale === 'ar' ? '، ' : ', ') : tx(P.noChannel)
}

/**
 * A lead on the board. Its status word is the follow-up when one is due; its
 * waiting fact says when the next contact is (red once that day has passed);
 * then whose it is and what is on file, and since when it has waited. Its one
 * action opens it. A converted or lost lead is a quiet card: the name and why.
 */
function LeadCard({ row, selected, onOpen }: { row: LeadRow; selected: boolean; onOpen: () => void }) {
  const { locale } = useI18n()
  const tx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const ended = row.stage === 'converted' || row.stage === 'lost'
  const on = (d: string) => dayName(d, locale, false)
  const fact = ended
    ? row.stage === 'lost'
      ? lostText(row.lostReason, locale) || undefined
      : tx(P.handedOver)
    : row.nextFollowUpOn
      ? row.followUpDue
        ? sentence(tx(P.dueSince), { what: tx(P.followUpDue), date: <span className="rq-age rq-age--late">{on(row.nextFollowUpOn)}</span> })
        : sentence(tx(P.followUpOn), { date: on(row.nextFollowUpOn) })
      : row.lastContactedAt
        ? tx(P.noFollowUp)
        : tx(P.neverContacted)
  const age = row.lastContactedAt ? (
    <>{tx(P.lastContactAge).split('{age}')[0]}<Age iso={row.lastContactedAt} /></>
  ) : (
    <>{tx(P.addedAge).split('{age}')[0]}<Age iso={row.createdAt} /></>
  )
  return (
    <BoardCard
      title={row.displayName}
      // A working lead's one action is to open it; an ended lead's quiet card opens from its name.
      titleOpens={ended}
      selected={selected}
      onOpen={onOpen}
      quiet={ended}
      fact={fact}
      age={age}
      actions={
        <RowActions
          label={`${tx(P.moreActions)}: ${row.displayName}`}
          primary={
            <button type="button" className="btn btn--sm" onClick={onOpen} aria-label={`${tx(P.open)} ${row.displayName}`} aria-current={selected ? 'true' : undefined}>
              {tx(P.open)}
            </button>
          }
        />
      }
    >
      {!ended && (
        <>
          <p className="rq-card__line">
            <Icon name="user" size={16} />
            {row.owner?.name ? <bdi>{row.owner.name}</bdi> : <span>{tx(P.unassigned)}</span>}
          </p>
          <p className="rq-card__line">
            <Icon name="phone" size={16} />
            <span>{row.contact.phone || row.contact.whatsapp || row.contact.email ? channelsText(row.contact, tx, locale) : tx(P.noContactOnFile)}</span>
          </p>
        </>
      )}
    </BoardCard>
  )
}
