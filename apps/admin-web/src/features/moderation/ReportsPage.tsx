import { useMemo, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { holdsAny } from '@/core/permissions/capabilities'
import { ApiError } from '@/core/api/errors'
import { Badge } from '@/shared/components/Badge'
import { PageHeader } from '@/shared/components/PageHeader'
import { QueryBoundary } from '@/shared/components/States'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { REASONS, STATUSES, type QueueFilters, type ReportReason, type ReportStatus } from './api'
import { MOD, REASON, STATUS, useCopy } from './copy'
import { DueClockView } from './DueClockView'
import { isNotAvailable, useForgetReport, useNow, useReports, useTake } from './hooks'
import { ReportDetail, SubjectView } from './ReportDetail'
import './moderation.css'

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
  const { locale, dateTime } = useI18n()
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

  return (
    <div className="page">
      <PageHeader title={tx(MOD.title)} subtitle={tx(MOD.subtitle)} />
      <p className="field__hint">{tx(MOD.draftNote)}</p>
      <div className="sa-filters">
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
        <label className="sa-check">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
          {tx(MOD.childSafetyOnly)}
        </label>
        <label className="sa-check">
          <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
          {tx(MOD.overdueOnly)}
        </label>
      </div>
      {goneNotice && (
        <div className="field__hint" role="status">
          {tx(MOD.notAvailable)}
        </div>
      )}
      {takeError && (
        <div className="field__error" role="alert">
          {takeError.code === 'COMM.REPORT_ALREADY_TAKEN' ? tx(MOD.alreadyTaken) : takeError.localized(locale)}
        </div>
      )}
      <QueryBoundary isLoading={list.isLoading} error={list.error} isEmpty={rows.length === 0} emptyTitle={tx(MOD.empty)} onRetry={() => void list.refetch()}>
        <div className="table-wrap">
          <table className="table">
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
                    <td>
                      {tx(REASON[r.reason] ?? { ar: r.reason, en: r.reason })}{' '}
                      {(r.priority === 'urgent' || r.reason === 'child_safety') && (
                        <Badge tone="danger" dot>
                          {tx(MOD.childSafetyBadge)}
                        </Badge>
                      )}
                    </td>
                    <td>
                      <SubjectView subject={r.subject} targetKind={r.targetKind} testId="row-subject" />
                    </td>
                    <td>
                      {tx(STATUS[r.status] ?? { ar: r.status, en: r.status })}{' '}
                      {r.reporterAnsweredAt ? <Badge tone="ok">{tx(MOD.answered)}</Badge> : null}
                    </td>
                    <td>
                      <DueClockView dueAt={r.dueAt} status={r.status} nowMs={nowMs} overdueAt={r.overdueAt} />
                    </td>
                    <td>{dateTime(r.createdAt)}</td>
                    <td className="mod-actions">
                      <button type="button" className="btn btn--sm" onClick={() => { setGoneNotice(false); setOpenId(r.id) }}>
                        {tx(MOD.view)}
                      </button>
                      {canAct && r.status === 'open' && (
                        <button type="button" className="btn btn--sm" disabled={take.isPending} onClick={() => take.mutate(r.id, { onError: (e) => isNotAvailable(e) && gone(r.id) })}>
                          {tx(MOD.take)}
                        </button>
                      )}
                      {canAct && open && (
                        <button type="button" className="btn btn--sm btn--primary" onClick={() => setOpenId(r.id)}>
                          {tx(MOD.resolve)}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </QueryBoundary>
      {openId && <ReportDetail id={openId} canAct={canAct} onClose={() => setOpenId(null)} onGone={gone} />}
    </div>
  )
}
