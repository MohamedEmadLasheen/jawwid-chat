import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  commandCenterApi,
  humanDuration,
  overloadTone,
  type SupervisorLoad,
} from '@/core/api/phase6'
import { qk } from '@/core/api/queryKeys'
import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import { Badge } from '@/shared/components/Badge'

/**
 * THE MANAGER COMMAND CENTER.
 *
 * "Where is the operation at risk right now?" -- answered in five seconds, and
 * every answer opens.
 *
 * ## Every number is a link
 *
 * A number that cannot be drilled into is a vanity metric. If a tile has no
 * filtered list behind it, it is not a button -- and the three that are not
 * (open, closed, active families) are rendered as plain figures rather than as
 * dead-end cards pretending to be actionable.
 *
 * ## Ordered by urgency, not by category
 *
 * The tiles a manager acts on come first; the ones that describe the shape of
 * the operation come second. Within the supervisor table, worst first.
 *
 * ## No charts
 *
 * There is nothing here a sparkline would say better than a number and a row.
 * Operational clarity over decorative dashboard design: a manager needs to know
 * what needs attention, how urgent it is, and who is overloaded.
 *
 * ## Freshness is stated, never implied
 *
 * `as of HH:MM` is rendered next to the header. Stale operational numbers
 * presented as live are worse than no numbers, and the queries refetch on the
 * moderation and conversation events that would change them.
 */
export function CommandCenterPage() {
  const { number } = useI18n()
  const navigate = useNavigate()
  const [focus, setFocus] = useState<{ staffId?: string; label: string } | null>(null)

  const header = useQuery({
    queryKey: qk.commandCenterKpis,
    queryFn: () => commandCenterApi.kpis(),
  })
  const team = useQuery({
    queryKey: qk.commandCenterSupervisors,
    queryFn: () => commandCenterApi.supervisors(),
  })
  const attention = useQuery({
    queryKey: qk.commandCenterAttention(focus?.staffId),
    queryFn: () => commandCenterApi.attention(focus?.staffId),
    enabled: focus !== null,
  })

  const k = header.data?.kpis

  return (
    <div className="page">
      <header className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 className="page__title">Command Center</h1>
        {k && (
          <span className="muted">
            as of {new Date(k.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </header>

      {/* ---------------------------------------------------- what needs action */}
      <QueryBoundary
        isLoading={header.isLoading}
        error={header.error}
        onRetry={() => void header.refetch()}
      >
        {k && (
          <>
            <section className="card">
              <h2 className="panel__title">Needs attention</h2>
              <div className="grid grid--metrics">
                <Metric
                  value={number(k.unansweredMessages)}
                  label="Unanswered"
                  alert={k.unansweredMessages > 0}
                  onClick={() => setFocus({ label: 'Unanswered conversations' })}
                />
                <Metric
                  value={number(k.pendingApprovals)}
                  label="Pending approvals"
                  alert={k.pendingApprovals > 0}
                  onClick={() => navigate('/moderation')}
                />
                <Metric
                  value={number(k.escalatedApprovals)}
                  label="Escalated to you"
                  alert={k.escalatedApprovals > 0}
                  onClick={() => navigate('/moderation?escalated=true')}
                />
                <Metric
                  value={number(k.overloadedSupervisors)}
                  label="Overloaded supervisors"
                  alert={k.overloadedSupervisors > 0}
                  onClick={() => document.getElementById('team')?.scrollIntoView()}
                />
              </div>

              {/* The target is zero, so zero deserves to be said out loud. */}
              {k.unansweredMessages === 0 &&
                k.pendingApprovals === 0 &&
                k.overloadedSupervisors === 0 && (
                  <div className="banner banner--info" style={{ marginBlockStart: 'var(--space-3)' }}>
                    Nothing needs you right now.
                  </div>
                )}
            </section>

            {/* -------------------------------------------- the shape of the day */}
            <section className="card">
              <h2 className="panel__title">The operation</h2>
              <div className="grid grid--metrics">
                {/* Deliberately NOT buttons: these describe the operation, and
                    inventing a filtered list behind each would be a dead end
                    wearing a link's clothes. */}
                <Figure value={number(k.openConversations)} label="Open conversations" />
                <Figure value={number(k.closedConversations)} label="Closed conversations" />
                <Figure value={number(k.activeFamilies)} label="Active families" />
                <Figure value={number(k.calls)} label={`Calls (${k.windowHours}h)`} />
                <Figure
                  value={number(k.missedClassCalls)}
                  label={`Missed class calls (${k.windowHours}h)`}
                  alert={k.missedClassCalls > 0}
                />
              </div>
            </section>
          </>
        )}
      </QueryBoundary>

      {/* -------------------------------------------------------- supervisors */}
      <section className="card" id="team">
        <h2 className="panel__title">Supervisors</h2>
        <QueryBoundary
          isLoading={team.isLoading}
          error={team.error}
          isEmpty={(team.data?.supervisors ?? []).length === 0}
          emptyTitle="No supervisors are configured."
          onRetry={() => void team.refetch()}
        >
          <table className="table">
            <thead>
              <tr>
                <th>Supervisor</th>
                <th>Presence</th>
                <th className="num">Families</th>
                <th className="num">Unread</th>
                <th className="num">Unanswered</th>
                <th className="num">Pending</th>
                <th>Longest wait</th>
                <th>Load</th>
              </tr>
            </thead>
            <tbody>
              {(team.data?.supervisors ?? []).map((row) => (
                <SupervisorRow
                  key={row.staffId}
                  row={row}
                  onDrill={() =>
                    setFocus({ staffId: row.staffId, label: `${row.name}: unanswered` })
                  }
                  onModeration={() => navigate('/moderation')}
                />
              ))}
            </tbody>
          </table>
        </QueryBoundary>
      </section>

      {/* ---------------------------------------------------------- drill-down */}
      {focus && (
        <section className="card">
          <header className="row" style={{ justifyContent: 'space-between' }}>
            <h2 className="panel__title">{focus.label}</h2>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setFocus(null)}>
              Close
            </button>
          </header>
          <QueryBoundary
            isLoading={attention.isLoading}
            error={attention.error}
            isEmpty={(attention.data ?? []).length === 0}
            emptyTitle="Nothing is waiting here."
            onRetry={() => void attention.refetch()}
          >
            <table className="table">
              <thead>
                <tr>
                  <th>Family</th>
                  <th>Conversation</th>
                  <th>Supervisor</th>
                  <th>Waiting</th>
                  <th className="num">Pending</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(attention.data ?? []).map((row) => (
                  <tr key={row.conversationId}>
                    <td>{row.familyName ?? row.familyId}</td>
                    <td>{row.conversationTitle ?? row.conversationType}</td>
                    <td>{row.supervisorName}</td>
                    <td>
                      {/* Colour is never the only signal: the badge carries the
                          elapsed time in words. */}
                      <Badge tone={row.waitingMs > 3600_000 ? 'danger' : 'today'}>
                        {humanDuration(row.waitingMs)}
                      </Badge>
                    </td>
                    <td className="num">{number(row.pendingApprovals)}</td>
                    <td>
                      {/* THE END OF THE DRILL-DOWN: the actual conversation. */}
                      <button
                        type="button"
                        className="btn btn--sm btn--primary"
                        onClick={() => navigate(`/console/${row.conversationId}`)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </QueryBoundary>
        </section>
      )}
    </div>
  )
}

function SupervisorRow({
  row,
  onDrill,
  onModeration,
}: {
  row: SupervisorLoad
  onDrill: () => void
  onModeration: () => void
}) {
  const { number } = useI18n()
  return (
    <tr>
      <td>{row.name}</td>
      <td>
        <Badge tone={row.presence === 'online' ? 'ok' : 'neutral'}>{row.presence}</Badge>
      </td>
      {/* Reported, but NOT a load input: a supervisor with 200 quiet families is
          not overloaded and one with 20 noisy ones may be. */}
      <td className="num">{number(row.families)}</td>
      <td className="num">{number(row.unreadMessages)}</td>
      <td className="num">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onDrill}>
          {number(row.unanswered)}
        </button>
      </td>
      <td className="num">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onModeration}>
          {number(row.pendingApprovals)}
          {row.escalated > 0 && <> ({number(row.escalated)} escalated)</>}
        </button>
      </td>
      <td>{row.unanswered > 0 ? humanDuration(row.oldestWaitMs) : '—'}</td>
      <td>
        <Badge tone={overloadTone(row.overload)}>{row.overload}</Badge>
        {/* THE BADGE IS NEVER SHOWN ALONE. The breakdown is its justification:
            "overloaded" without it is an accusation; with it, it is a
            description a manager can act on. */}
        {row.reasons.length > 0 && <div className="muted">{row.reasons.join(' · ')}</div>}
      </td>
    </tr>
  )
}

function Metric({
  value,
  label,
  alert,
  onClick,
}: {
  value: string
  label: string
  alert?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className={alert ? 'metric metric--alert' : 'metric'} onClick={onClick}>
      <div className="metric__value">{value}</div>
      <div className="metric__label">{label}</div>
    </button>
  )
}

/** A figure with no list behind it. Not a button, so it is not a dead end. */
function Figure({ value, label, alert }: { value: string; label: string; alert?: boolean }) {
  return (
    <div className={alert ? 'metric metric--alert' : 'metric'}>
      <div className="metric__value">{value}</div>
      <div className="metric__label">{label}</div>
    </div>
  )
}
