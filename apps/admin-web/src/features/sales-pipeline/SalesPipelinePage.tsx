import { useEffect, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { Age, FlowStrip, FlowStripCell, RequestQueue, RowOpen, rowOpener, type FlowCell } from '@/shared/components/RequestQueue'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { STAGES, type ContactPresence, type LeadDetail, type LeadRow, type Stage } from './api'
import { CreateLeadDialog } from './CreateLeadDialog'
import { LeadPanel, LeadStatus } from './LeadDetail'
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
 * queue under its stages (the counts are the board's column heads). A lead is
 * a trial prospect; Trial booked, Trial completed, Converted and a trial's Lost
 * come from the trial itself. A row says whether a channel is on file, never the
 * contact: that arrives with the lead's own panel, and is audited -- so the
 * panel is there only while a lead is open, never by itself. The server decides
 * who may open any of it.
 */
export function SalesPipelinePage() {
  const { locale, number } = useI18n()
  const tx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const [stage, setStage] = useState<StageFilter>('all')
  const [search, setSearch] = useState('')
  const [due, setDue] = useState(false)
  const [offset, setOffset] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const q = useDebounced(search.trim())
  // The server decides who may open the pipeline. An account it refuses (a Teachers or
  // Finance account that typed the address) gets the Forbidden page, not the page's frame.
  const access = usePipelineAccess()
  const refused = access.data?.allowed === false || (access.error instanceof ApiError && access.error.status === 403)

  const list = useLeads({ stage: stage === 'all' ? '' : stage, q, followUp: due ? 'due' : '', limit: PAGE_SIZE, offset })
  useEffect(() => setOffset(0), [stage, q, due])
  // The open lead, as its panel read it (the one audited read of the contact happens there, on opening).
  const [loaded, setLoaded] = useState<LeadDetail | null>(null)
  const lead = loaded && loaded.id === openId ? loaded : null

  if (refused) return <ForbiddenPage />

  const data = list.data
  const counts = data?.counts
  const total = counts ? STAGES.reduce((n, s) => n + counts[s], 0) : null
  const cells: Array<FlowCell<StageFilter>> = [
    { key: 'all', label: tx(P.all), count: total },
    ...STAGES.map((s) => ({ key: s as StageFilter, label: tx(STAGE[s].label), count: counts ? counts[s] : null })),
  ]
  const rows = data?.leads ?? []
  const last = data ? Math.min(data.offset + rows.length, data.total) : 0
  const openRow = rows.find((r) => r.id === openId)

  return (
    <div className="page rq-page">
      <div className="page__inner">
        <PageHeader
          title={tx(P.title)}
          subtitle={tx(P.subtitle)}
          actions={<button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>{tx(P.newLead)}</button>}
        />
        <FlowStrip label={tx(P.filterLabel)} cells={cells} value={stage} onChange={setStage}>
          {/* Not a stage: the leads whose follow-up date has passed, across every stage. */}
          <FlowStripCell
            cell={{ label: tx(P.followUpDue), count: data ? data.dueCount : null, late: (data?.dueCount ?? 0) > 0 }}
            active={due}
            onClick={() => setDue((d) => !d)}
          />
        </FlowStrip>
        <RequestQueue
          label={tx(P.panelLabel)}
          detail={
            openId
              ? {
                  id: openId,
                  title: lead?.displayName ?? openRow?.displayName ?? tx(P.lead),
                  kind: { icon: 'pipeline', label: tx(P.kind) },
                  status: lead ? <LeadStatus lead={lead} /> : openRow ? <LeadStatus lead={openRow} /> : undefined,
                  onClose: () => setOpenId(null),
                  body: <LeadPanel id={openId} onLead={setLoaded} />,
                }
              : null
          }
        >
          <div className="rq-toolbar">
            <label className="search">
              <Icon name="search" size={16} />
              <span className="sr-only">{tx(P.search)}</span>
              <input className="input" type="search" value={search} placeholder={tx(P.search)} aria-describedby="sp-search-hint" onChange={(e) => setSearch(e.target.value)} />
            </label>
            <span id="sp-search-hint" className="rq-toolbar__hint">{tx(P.searchHint)}</span>
          </div>
          <QueryBoundary isLoading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            {rows.length === 0 ? (
              <EmptyState title={total === 0 && stage === 'all' && !q && !due ? tx(P.empty) : tx(P.noMatch)} />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table rq-table">
                    <thead>
                      <tr>
                        <th scope="col">{tx(P.lead)}</th>
                        <th scope="col">{tx(P.stage)}</th>
                        <th scope="col" className="rq-c--more">{tx(P.owner)}</th>
                        <th scope="col" className="rq-c--extra">{tx(P.lastContacted)}</th>
                        <th scope="col">{tx(P.nextFollowUp)}</th>
                        <th scope="col" className="rq-c--extra">{tx(P.channels)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <LeadRowView key={r.id} row={r} selected={r.id === openId} onOpen={() => setOpenId(r.id)} />
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* One page needs no pager. */}
                {data && data.total > rows.length && (
                <div className="lead-pager">
                  <span className="ts-muted ltr">{number(data!.offset + 1)}–{number(last)} / {number(data!.total)}</span>
                  <button type="button" className="btn btn--sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>{tx(P.previous)}</button>
                  <button type="button" className="btn btn--sm" disabled={!data || last >= data.total} onClick={() => setOffset(offset + PAGE_SIZE)}>{tx(P.next)}</button>
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

function channelsText(c: ContactPresence, tx: (p: { en: string; ar: string }) => string): string {
  const on = [c.phone && tx(P.phone), c.whatsapp && tx(P.whatsapp), c.email && tx(P.email)].filter(Boolean)
  return on.length > 0 ? on.join(' · ') : tx(P.noChannel)
}

function LeadRowView({ row, selected, onOpen }: { row: LeadRow; selected: boolean; onOpen: () => void }) {
  const { locale, date } = useI18n()
  const tx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const stage = STAGE[row.stage]
  return (
    <tr data-selected={selected || undefined} onClick={rowOpener(onOpen)}>
      <th scope="row" className="rq-c-who">
        <RowOpen selected={selected} onOpen={onOpen} label={`${tx(P.open)} ${row.displayName}`}>{row.displayName}</RowOpen>
      </th>
      <td className="rq-c-status">
        <Badge tone={stage.tone} dot>{tx(stage.label)}</Badge>
        {row.stage === 'lost' && row.lostReason && <span className="rq-sub">{lostText(row.lostReason, locale)}</span>}
      </td>
      <td className="rq-c-meta rq-c--more">{row.owner?.name ? <bdi>{row.owner.name}</bdi> : <span className="rq-muted">{tx(P.unassigned)}</span>}</td>
      <td className="rq-c--extra">
        {row.lastContactedAt ? <Age iso={row.lastContactedAt} /> : <span className="rq-muted">{tx(P.never)}</span>}
      </td>
      <td className="rq-c-when">
        {row.nextFollowUpOn ? (
          <>
            <time dateTime={row.nextFollowUpOn} className={row.followUpDue ? 'rq-age rq-age--late' : 'rq-age'}>{date(`${row.nextFollowUpOn}T12:00:00Z`)}</time>
            {row.followUpDue && <span className="rq-sub lead-due">{tx(P.followUpDue)}</span>}
          </>
        ) : (
          <span className="rq-muted">—</span>
        )}
      </td>
      <td className="rq-c--extra">{channelsText(row.contact, tx)}</td>
    </tr>
  )
}
