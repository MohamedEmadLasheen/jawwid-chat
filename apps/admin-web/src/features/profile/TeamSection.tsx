import { useI18n } from '@/core/i18n/I18nProvider'
import type { MastFigure } from '@/shared/components/PageHeader'
import { QueryBoundary } from '@/shared/components/States'
import type { Team } from './api'
import { METRICS, T, useCopy } from './copy'
import { useTeam } from './hooks'
import { StaffTable } from './StaffTable'

/**
 * "My team", a tab of a manager's own profile: the staff whose reporting line
 * names them, as the server returns it, on one sheet (the same roster as the
 * Team page), beside the team's sums on the canvas. Totals are exact sums for
 * families/students/conversations/approvals (each belongs to one supervisor);
 * teachers are the server's DISTINCT count, never a sum of the rows.
 */
export function TeamSection() {
  const tx = useCopy()
  const team = useTeam(true)
  const t = team.data

  return (
    <section className="split rec-split rec-split--lead sp-team" aria-labelledby="sp-team">
      {/* Written first and set at the end: on a narrow screen the sums lead the list. */}
      <aside className="rec-aside">{t && t.members.length > 0 && <TeamTotals team={t} />}</aside>
      <div className="rec-main">
        <div className="sheet dir-sheet">
          <div className="sheet__head">
            <h2 id="sp-team" className="sheet__title">{tx(T.myTeam)}</h2>
          </div>
          <p className="rec-sheet__rule sp-roster__rule">{tx(T.myTeamHint)}</p>
          <QueryBoundary
            isLoading={team.isLoading}
            error={team.error}
            isEmpty={(t?.members.length ?? 0) === 0}
            emptyTitle={tx(T.noTeam)}
            onRetry={() => void team.refetch()}
            compact
          >
            {t && <StaffTable rows={t.members} showManager={false} />}
          </QueryBoundary>
        </div>
      </div>
    </section>
  )
}

/** A team's sums as a group of facts on the canvas. Teachers are the server's DISTINCT count. */
export function TeamTotals({ team }: { team: Team }) {
  const tx = useCopy()
  const { number } = useI18n()
  return (
    <section className="aside-group rec-group" aria-labelledby="sp-team-totals">
      <div className="rec-group__head">
        <h3 id="sp-team-totals" className="aside-group__title">{tx(T.teamTotals)}</h3>
      </div>
      <div className="sp-totals">
        <TotalLine label={tx(T.directReports)} value={number(team.members.filter((m) => m.isActive).length)} />
        <TotalLine label={tx(T.colFamilies)} value={number(team.totals.assignedFamilies)} />
        <TotalLine label={tx(T.colStudents)} value={number(team.totals.studentsInAssignedFamilies)} />
        <TotalLine label={tx(T.colTeachers)} value={number(team.distinctTeachers)} />
        <TotalLine label={tx(T.colOpen)} value={number(team.totals.openConversations)} />
        <TotalLine label={tx(T.colAwaiting)} value={number(team.totals.awaitingReply)} strong={team.totals.awaitingReply > 0} />
        <TotalLine label={tx(T.colApprovals)} value={number(team.totals.pendingApprovals)} />
      </div>
      <p className="rec-rule">{tx(T.teamTotalsHint)}</p>
    </section>
  )
}

/** One sum: the figure comes first in the document and is drawn at the end of its line. */
function TotalLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? 'sp-total sp-total--key' : 'sp-total'}>
      <span className="sp-total__n">{value}</span>
      <span className="sp-total__label">{label}</span>
    </div>
  )
}

/**
 * The same sums as the Team page's masthead: the four that matter, with the
 * distinct teachers and the conversations waiting for us as the notes under
 * the figures they belong to.
 */
export function useTeamFigures(team: Team | undefined): MastFigure[] {
  const tx = useCopy()
  const { number } = useI18n()
  if (!team) return []
  const label = (key: (typeof METRICS)[number]['key']) => tx(METRICS.find((m) => m.key === key)!.label)
  const { totals } = team
  return [
    { key: 'families', label: tx(T.colFamilies), value: number(totals.assignedFamilies) },
    {
      key: 'students',
      label: tx(T.colStudents),
      value: number(totals.studentsInAssignedFamilies),
      note: tx(T.teachersNote, { n: number(team.distinctTeachers) }),
    },
    {
      key: 'open',
      label: label('openConversations'),
      value: number(totals.openConversations),
      note: totals.openConversations > 0 || totals.awaitingReply > 0 ? tx(T.awaitingNote, { n: number(totals.awaitingReply) }) : undefined,
      tone: totals.awaitingReply > 0 ? 'key' : undefined,
    },
    {
      key: 'approvals',
      label: label('pendingApprovals'),
      value: number(totals.pendingApprovals),
      tone: totals.pendingApprovals === 0 ? 'quiet' : undefined,
    },
  ]
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
