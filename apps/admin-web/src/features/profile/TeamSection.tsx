import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import type { Team } from './api'
import { T, useCopy } from './copy'
import { useTeam } from './hooks'
import { StaffTable } from './StaffTable'

/**
 * A manager's team: the staff whose reporting line names them, as the server
 * returns it. Totals are exact sums for families/students/conversations/
 * approvals (each belongs to one supervisor); teachers are the server's
 * DISTINCT count, never a sum of the rows.
 */
export function TeamSection() {
  const tx = useCopy()
  const team = useTeam(true)
  const t = team.data

  return (
    <section className="pp-sec sp-team" aria-labelledby="sp-team">
      <div className="pp-sec__head">
        <h2 id="sp-team" className="pp-sec__title">{tx(T.myTeam)}</h2>
      </div>
      <p className="pp-rule">{tx(T.myTeamHint)}</p>
      <QueryBoundary
        isLoading={team.isLoading}
        error={team.error}
        isEmpty={(t?.members.length ?? 0) === 0}
        emptyTitle={tx(T.noTeam)}
        onRetry={() => void team.refetch()}
        compact
      >
        {t && (
          <>
            <TeamTotals team={t} />
            <StaffTable rows={t.members} showManager={false} />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}

/** A team's sums as one ruled ledger. Teachers are the server's DISTINCT count. */
export function TeamTotals({ team }: { team: Team }) {
  const tx = useCopy()
  const { number } = useI18n()
  return (
    <>
      <div className="ledger sp-ledger" aria-label={tx(T.teamTotals)}>
        <Total label={tx(T.directReports)} value={number(team.members.filter((m) => m.isActive).length)} />
        <Total label={tx(T.colFamilies)} value={number(team.totals.assignedFamilies)} />
        <Total label={tx(T.colStudents)} value={number(team.totals.studentsInAssignedFamilies)} />
        <Total label={tx(T.colTeachers)} value={number(team.distinctTeachers)} />
        <Total label={tx(T.colOpen)} value={number(team.totals.openConversations)} />
        <Total label={tx(T.colAwaiting)} value={number(team.totals.awaitingReply)} />
        <Total label={tx(T.colApprovals)} value={number(team.totals.pendingApprovals)} />
      </div>
      <p className="pp-rule sp-workload__rule">{tx(T.teamTotalsHint)}</p>
    </>
  )
}

/** One figure of a ledger. The figure comes first in the document and is drawn under its label. */
export function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="ledger__cell">
      <div className="ledger__value">{value}</div>
      <div className="ledger__label">{label}</div>
    </div>
  )
}
