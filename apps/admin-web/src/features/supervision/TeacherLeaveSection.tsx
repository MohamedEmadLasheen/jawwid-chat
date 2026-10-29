import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '@/core/auth/SessionProvider'
import { canOpenArea, isSuperAdmin } from '@/core/permissions/capabilities'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { adminSectionPath } from '@/features/admin/sections'
import { S, describeError, useCopy } from './copy'
import { useOpenSupervision, useTeacherLeave } from './hooks'
import { LEAVE_STATE, useLeaveDates } from './LeaveRequestsPage'
import { SetAllowanceDialog } from './SupervisionDialogs'
import './supervision.css'

/**
 * PD-12 on the Teacher File: this year's allowance, what is used and what is
 * left (computed by the server, never stored), and the year's requests. The
 * section is absent for anyone the server refuses.
 */
export function TeacherLeaveSection({ teacherId, canSetAllowance }: { teacherId: string; canSetAllowance: boolean }) {
  const tx = useCopy()
  const { number } = useI18n()
  const dates = useLeaveDates()
  const leave = useTeacherLeave(teacherId)
  const [editing, setEditing] = useState(false)
  if (leave.isLoading || leave.error || !leave.data) return null
  const d = leave.data
  const figure = (v: number | null | undefined) => (v === null || v === undefined ? <span className="sv-muted">{tx(S.noAllowance)}</span> : number(v))

  return (
    <section className="card panel tf-section" aria-labelledby="tf-leave">
      <div className="tf-section__head">
        <h2 id="tf-leave" className="tf-section__title">
          {tx(S.leaveSection)}
        </h2>
        {canSetAllowance && (
          <button type="button" className="btn btn--sm" onClick={() => setEditing(true)}>
            {tx(S.setAllowance)}
          </button>
        )}
      </div>
      {/* The figures are the Teachers department's; the server leaves them out for anyone else. */}
      {d.used !== undefined && (
        <dl className="sv-figures">
          <div className="sv-figure">
            <dt>{tx(S.allowance, { year: d.year })}</dt>
            <dd>{figure(d.allowance)}</dd>
          </div>
          <div className="sv-figure">
            <dt>{tx(S.used)}</dt>
            <dd>{number(d.used)}</dd>
          </div>
          <div className="sv-figure">
            <dt>{tx(S.balance)}</dt>
            <dd>{figure(d.balance)}</dd>
          </div>
        </dl>
      )}
      {d.requests.length === 0 ? (
        <p className="tf-muted">{tx(S.noRequestsYear)}</p>
      ) : (
        <ul className="tf-entries">
          {d.requests.map((r) => (
            <li key={r.id} className="tf-entry">
              <div className="tf-entry__head">
                <strong>{dates(r)}</strong>
                <Badge tone={LEAVE_STATE[r.state].tone} dot>
                  {tx(LEAVE_STATE[r.state].label)}
                </Badge>
                <span className="tf-muted">
                  {tx(S.days)}: {number(r.days)}
                </span>
              </div>
              <p className="tf-entry__body" dir="auto">
                {r.reason}
              </p>
              {r.decisionNote && (
                <p className="tf-entry__body tf-muted" dir="auto">
                  {r.decisionNote}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <SetAllowanceDialog teacherId={teacherId} year={d.year} current={d.allowance ?? null} onClose={() => setEditing(false)} />}
    </section>
  )
}

/**
 * Open this teacher's supervision conversation (created on first use) in the
 * chat workspace the viewer has: the operator chat, or the super admin's
 * Conversations section.
 */
export function OpenSupervisionButton({ teacherId }: { teacherId: string }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const { staff } = useSession()
  const navigate = useNavigate()
  const open = useOpenSupervision()
  if (!staff) return null
  const go = (conversationId: string) =>
    navigate(
      isSuperAdmin(staff.role)
        ? `${adminSectionPath('conversations')}?c=${encodeURIComponent(conversationId)}`
        : canOpenArea(staff.role, 'chat')
          ? `/chat/${encodeURIComponent(conversationId)}`
          : '/',
    )
  return (
    <>
      <button
        type="button"
        className="btn btn--sm"
        disabled={open.isPending}
        onClick={() => open.mutate(teacherId, { onSuccess: (r) => go(r.conversationId) })}
      >
        {open.isPending ? tx(S.openingChat) : tx(S.openChat)}
      </button>
      {open.error ? (
        <span className="field__error" role="alert">
          {describeError(open.error, locale)}
        </span>
      ) : null}
    </>
  )
}
