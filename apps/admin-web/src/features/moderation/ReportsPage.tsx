import { useMemo, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { holdsAny } from '@/core/permissions/capabilities'
import { ApiError } from '@/core/api/errors'
import { Badge, type Tone } from '@/shared/components/Badge'
import { PageHeader, type MastFigure } from '@/shared/components/PageHeader'
import { RequestQueue } from '@/shared/components/RequestQueue'
import { RowActions } from '@/shared/components/RowActions'
import { QueryBoundary } from '@/shared/components/States'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { REASONS, STATUSES, type QueueFilters, type ReportReason, type ReportStatus } from './api'
import { MOD, REASON, STATUS, useCopy } from './copy'
import { DueClockView } from './DueClockView'
import { isNotAvailable, useForgetReport, useNow, useReports, useTake } from './hooks'
import { ReportDetailBody, SubjectView } from './ReportDetail'
import './moderation.css'
import '@/features/teachers/rows.css'

/** A report's status as a dot and a word: waiting is gold, in hand is teal, closed is quiet. */
const STATUS_TONE: Partial<Record<ReportStatus, Tone>> = { open: 'warn', in_review: 'info', actioned: 'ok' }

export const MODERATION_VIEW_KEYS = ['moderation.view'] as const
const ACT_KEYS = ['moderation.act'] as const

/**
 * WP-1C (PD-57): the moderation queue. Urgent first, then by time left -- the
 * server's order, kept as returned. Every picker is a SearchableSelect. The
 * contract has no `reason` query parameter, so the reason filter narrows the
 * rows already returned. UX only: the server decides each request.
 * Access is scoped on the server (closure plan §3): a 404 on the detail, take,
 * resolve or an attachment means "not available to you", so the row is
 * dropped, the detail closed, and a calm notice shown.
 */
export function ReportsPage() {
  const tx = useCopy()
  const { locale, dateTime, number } = useI18n()
  const { staff } = useSession()
  const canAct = holdsAny(staff, ACT_KEYS)
  const [status, setStatus] = useState<'' | ReportStatus>('')
  const [reason, setReason] = useState<'' | ReportReason>('')
  const [urgent, setUrgent] = useState(false)
  const [overdue, setOverdue] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const filters: QueueFilters = { status: status || undefined, urgent, overdue }
  const list = useReports(filters)
  const take = useTake()
  const nowMs = useNow()
  const rows = useMemo(() => (list.data ?? []).filter((r) => reason === '' || r.reason === reason), [list.data, reason])
  const takeError = take.error instanceof ApiError && !take.error.isNotFound ? take.error : null
  const forget = useForgetReport()
  const [goneNotice, setGoneNotice] = useState(false)
  function gone(id: string) {
    forget(id)
    setOpenId((cur) => (cur === id ? null : cur))
    setGoneNotice(true)
  }

  const all = list.data ?? []
  const figures: MastFigure[] = list.data
    ? [
        { key: 'open', label: tx(STATUS.open), value: number(all.filter((r) => r.status === 'open').length), tone: 'key' },
        { key: 'review', label: tx(STATUS.in_review), value: number(all.filter((r) => r.status === 'in_review').length) },
        { key: 'urgent', label: tx(MOD.childSafetyBadge), value: number(all.filter((r) => r.priority === 'urgent' || r.reason === 'child_safety').length), tone: all.some((r) => r.priority === 'urgent' || r.reason === 'child_safety') ? 'urgent' : 'quiet' },
      ]
    : []

  return (
    <div className="page">
      <div className="page__inner">
      <PageHeader title={tx(MOD.title)} subtitle={tx(MOD.subtitle)} figures={figures} />
      <RequestQueue
        label={tx(MOD.detailTitle)}
        detail={openId ? { id: openId, title: tx(MOD.detailTitle), body: <ReportDetailBody id={openId} canAct={canAct} onClose={() => setOpenId(null)} onGone={gone} />, onClose: () => setOpenId(null) } : null}
      >
      <section className="sheet" aria-label={tx(MOD.title)}>
      <div className="sheet-bar mod-filters">
        <label className="field">
          <span className="field__label">{tx(MOD.filterStatus)}</span>
          <SearchableSelect
            aria-label={tx(MOD.filterStatus)}
            value={status}
            onValueChange={(v) => setStatus(v as '' | ReportStatus)}
            options={[{ value: '', label: tx(MOD.anyStatus) }, ...STATUSES.map((s) => ({ value: s, label: tx(STATUS[s]) }))]}
            clearable={false}
          />
        </label>
        <label className="field">
          <span className="field__label">{tx(MOD.filterReason)}</span>
          <SearchableSelect
            aria-label={tx(MOD.filterReason)}
            value={reason}
            onValueChange={(v) => setReason(v as '' | ReportReason)}
            options={[{ value: '', label: tx(MOD.anyReason) }, ...REASONS.map((s) => ({ value: s, label: tx(REASON[s]) }))]}
            clearable={false}
          />
        </label>
        <label className="mod-check">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
          {tx(MOD.childSafetyOnly)}
        </label>
        <label className="mod-check">
          <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
          {tx(MOD.overdueOnly)}
        </label>
        <span className="sheet-bar__end mod-draft" title={tx(MOD.draftNote)}>
          {tx(MOD.draftNote)}
        </span>
      </div>
      {goneNotice && (
        <div className="mod-note" role="status">
          {tx(MOD.notAvailable)}
        </div>
      )}
      {takeError && (
        <div className="field__error mod-error" role="alert">
          {takeError.code === 'COMM.REPORT_ALREADY_TAKEN' ? tx(MOD.alreadyTaken) : takeError.localized(locale)}
        </div>
      )}
      <QueryBoundary isLoading={list.isLoading} error={list.error} isEmpty={rows.length === 0} emptyTitle={tx(MOD.empty)} onRetry={() => void list.refetch()}>
          <table className="rowlist">
            <thead>
              <tr>
                <th>{tx(MOD.colReason)}</th>
                <th>{tx(MOD.colTarget)}</th>
                <th>{tx(MOD.colStatus)}</th>
                <th>{tx(MOD.colDue)}</th>
                <th>{tx(MOD.colFiled)}</th>
                <th>{tx(MOD.colActions)}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const open = r.status === 'open' || r.status === 'in_review'
                return (
                  <tr key={r.id} data-testid="report-row" data-priority={r.priority}>
                    <td className="rw-who">
                      <span className="rw-who__text">
                        <span className="rw-name">
                          {tx(REASON[r.reason] ?? { ar: r.reason, en: r.reason })}{' '}
                          {(r.priority === 'urgent' || r.reason === 'child_safety') && (
                            <Badge tone="danger" dot>
                              {tx(MOD.childSafetyBadge)}
                            </Badge>
                          )}
                        </span>
                        <span className="rw-sub">{dateTime(r.createdAt)}</span>
                      </span>
                    </td>
                    <td className="rw-meta">
                      <SubjectView subject={r.subject} targetKind={r.targetKind} testId="row-subject" />
                    </td>
                    <td className="rw-tags">
                      <span className="mod-status">
                        <Badge tone={STATUS_TONE[r.status] ?? 'neutral'} dot>
                          {tx(STATUS[r.status] ?? { ar: r.status, en: r.status })}
                        </Badge>{' '}
                        {r.reporterAnsweredAt ? <span className="mod-answered">{tx(MOD.answered)}</span> : null}
                      </span>
                    </td>
                    <td className="rw-age">
                      <DueClockView dueAt={r.dueAt} status={r.status} nowMs={nowMs} overdueAt={r.overdueAt} />
                    </td>
                    <td className="cell-actions">
                      {/* One stated action opens the report beside the list; the others are behind the menu. */}
                      <RowActions
                        primary={
                          <button type="button" className={openId === r.id ? 'btn btn--sm btn--primary' : 'btn btn--sm'} onClick={() => { setGoneNotice(false); setOpenId(r.id) }}>
                            {tx(MOD.view)}
                          </button>
                        }
                        more={[
                          ...(canAct && r.status === 'open' && !take.isPending ? [{ key: 'take', label: tx(MOD.take), icon: 'userCheck' as const, onSelect: () => take.mutate(r.id, { onError: (e) => isNotAvailable(e) && gone(r.id) }) }] : []),
                          ...(canAct && open ? [{ key: 'resolve', label: tx(MOD.resolve), icon: 'checkCircle' as const, onSelect: () => setOpenId(r.id) }] : []),
                        ]}
                        label={`${tx(MOD.colActions)}: ${tx(REASON[r.reason] ?? { ar: r.reason, en: r.reason })}`}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
      </QueryBoundary>
      </section>
      </RequestQueue>
      </div>
    </div>
  )
}
