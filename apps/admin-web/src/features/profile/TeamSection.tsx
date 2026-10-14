import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
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
  const { number } = useI18n()
  const team = useTeam(true)
  const t = team.data

  return (
    <section className="card sp-card" aria-labelledby="sp-team">
      <h2 id="sp-team" className="sp-card__title">{tx(T.myTeam)}</h2>
      <p className="sp-footnote">{tx(T.myTeamHint)}</p>
      <QueryBoundary
        isLoading={team.isLoading}
        error={team.error}
        isEmpty={(t?.members.length ?? 0) === 0}
        emptyTitle={tx(T.noTeam)}
        onRetry={() => void team.refetch()}
      >
        {t && (
          <>
            <div className="sp-totals" aria-label={tx(T.teamTotals)}>
              <Total label={tx(T.directReports)} value={number(t.members.filter((m) => m.isActive).length)} />
              <Total label={tx(T.colFamilies)} value={number(t.totals.assignedFamilies)} />
              <Total label={tx(T.colStudents)} value={number(t.totals.studentsInAssignedFamilies)} />
              <Total label={tx(T.colTeachers)} value={number(t.distinctTeachers)} />
              <Total label={tx(T.colOpen)} value={number(t.totals.openConversations)} />
              <Total label={tx(T.colAwaiting)} value={number(t.totals.awaitingReply)} />
              <Total label={tx(T.colApprovals)} value={number(t.totals.pendingApprovals)} />
            </div>
            <p className="sp-footnote">{tx(T.teamTotalsHint)}</p>
            <StaffTable rows={t.members} showManager={false} />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}

export function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="sp-total">
      <div className="sp-total__value">{value}</div>
      <div className="sp-total__label">{label}</div>
    </div>
  )
}
