import { useEffect, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { FilterChips, type FilterOption } from '@/shared/components/FilterChips'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { formatWhen } from '@/features/trials/copy'
import { STAGES, type ContactPresence, type LeadRow, type Stage } from './api'
import { CreateLeadDialog } from './CreateLeadDialog'
import { LeadDrawer } from './LeadDrawer'
import { P, STAGE, lostText } from './copy'
import { useLeads } from './hooks'
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
 * list with a stage filter (the counts are the board's column heads). A lead is
 * a trial prospect; Trial booked, Trial completed, Converted and a trial's Lost
 * come from the trial itself. A row says whether a channel is on file, never the
 * contact: that arrives with the lead's own panel, and is audited. The server
 * decides who may open any of it.
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

  const list = useLeads({ stage: stage === 'all' ? '' : stage, q, followUp: due ? 'due' : '', limit: PAGE_SIZE, offset })
  useEffect(() => setOffset(0), [stage, q, due])

  const data = list.data
  const counts = data?.counts
  const total = counts ? STAGES.reduce((n, s) => n + counts[s], 0) : 0
  const options: Array<FilterOption<StageFilter>> = [
    { value: 'all', label: tx(P.all), count: total },
    ...STAGES.map((s) => ({ value: s as StageFilter, label: tx(STAGE[s].label), count: counts?.[s] ?? 0 })),
  ]
  const rows = data?.leads ?? []
  const last = data ? Math.min(data.offset + rows.length, data.total) : 0

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader
          title={tx(P.title)}
          subtitle={tx(P.subtitle)}
          actions={<button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>{tx(P.newLead)}</button>}
        />
        <div className="ns-toolbar">
          <label className="search ns-toolbar__search">
            <Icon name="search" size={16} />
            <span className="sr-only">{tx(P.search)}</span>
            <input className="input" type="search" value={search} placeholder={tx(P.search)} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <button type="button" className={`btn btn--sm${due ? ' btn--primary' : ''}`} aria-pressed={due} onClick={() => setDue((d) => !d)}>
            {tx(P.followUpDue)}{data ? ` (${number(data.dueCount)})` : ''}
          </button>
        </div>
        <FilterChips options={options} value={stage} onChange={setStage} label={tx(P.filterLabel)} formatCount={(n) => number(n)} />
        <QueryBoundary isLoading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
          {rows.length === 0 ? (
            <EmptyState title={total === 0 && stage === 'all' && !q && !due ? tx(P.empty) : tx(P.noMatch)} />
          ) : (
            <>
              <div className="table-wrap">
                <table className="table sp-table">
                  <thead>
                    <tr>
                      <th scope="col">{tx(P.lead)}</th>
                      <th scope="col">{tx(P.stage)}</th>
                      <th scope="col">{tx(P.lastContacted)}</th>
                      <th scope="col">{tx(P.nextFollowUp)}</th>
                      <th scope="col">{tx(P.channels)}</th>
                      <th scope="col"><span className="sr-only">{tx(P.open)}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <LeadRowView key={r.id} row={r} onOpen={() => setOpenId(r.id)} />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="sp-pager">
                <span className="ts-muted">{number(data!.offset + 1)}–{number(last)} / {number(data!.total)}</span>
                <button type="button" className="btn btn--sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>{tx(P.previous)}</button>
                <button type="button" className="btn btn--sm" disabled={!data || last >= data.total} onClick={() => setOffset(offset + PAGE_SIZE)}>{tx(P.next)}</button>
              </div>
              {data?.truncated && <p className="field__hint">{tx(P.truncated)}</p>}
            </>
          )}
        </QueryBoundary>
        {openId && <LeadDrawer id={openId} onClose={() => setOpenId(null)} />}
        {creating && <CreateLeadDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id) }} />}
      </div>
    </div>
  )
}

function channelsText(c: ContactPresence, tx: (p: { en: string; ar: string }) => string): string {
  const on = [c.phone && tx(P.phone), c.whatsapp && tx(P.whatsapp), c.email && tx(P.email)].filter(Boolean)
  return on.length > 0 ? on.join(' · ') : tx(P.noChannel)
}

function LeadRowView({ row, onOpen }: { row: LeadRow; onOpen: () => void }) {
  const { locale } = useI18n()
  const tx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const stage = STAGE[row.stage]
  return (
    <tr>
      <th scope="row" dir="auto">{row.displayName}</th>
      <td>
        <Badge tone={stage.tone} dot>{tx(stage.label)}</Badge>
        {row.stage === 'lost' && row.lostReason && <span className="ts-muted sp-reason"> {lostText(row.lostReason, locale)}</span>}
      </td>
      <td>{row.lastContactedAt ? <time dateTime={row.lastContactedAt}>{formatWhen(row.lastContactedAt, locale)}</time> : <span className="ts-muted">{tx(P.never)}</span>}</td>
      <td>
        {row.nextFollowUpOn ? (
          <>
            <time dateTime={row.nextFollowUpOn}>{row.nextFollowUpOn}</time>
            {row.followUpDue && <> <Badge tone="warn" dot>{tx(P.followUpDue)}</Badge></>}
          </>
        ) : (
          <span className="ts-muted">—</span>
        )}
      </td>
      <td>{channelsText(row.contact, tx)}</td>
      <td><button type="button" className="btn btn--sm" onClick={onOpen} aria-label={`${tx(P.open)} ${row.displayName}`}>{tx(P.open)}</button></td>
    </tr>
  )
}
