import { useI18n } from '@/core/i18n/I18nProvider'
import { PageHeader, type MastFigure } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { T, useCopy } from './copy'
import { useOrganization, useStaffProfile, useTeam } from './hooks'
import { StaffTable, summarize } from './StaffTable'
import { useTeamFigures } from './TeamSection'
import './profile.css'

/**
 * Team: the staff a viewer may list, each opening their profile.
 *
 * Nothing new is asked of the server. The viewer's own profile already says
 * what they may open (`viewer.team`, `viewer.organizationOverview`): a manager
 * gets the people whose reporting line names them (GET /staff-profiles/team),
 * the super admin the whole directory (GET /staff-profiles/organization).
 * Anyone else is told plainly; a staff profile still opens from a name.
 *
 * A roster: the masthead carries what the list adds up to (a manager's team:
 * its sums; the directory: how it is made up), and one sheet carries the
 * people, with its own bar to narrow them. The directory is set out under
 * each reporting manager.
 */
export function TeamPage() {
  const tx = useCopy()
  const { number } = useI18n()
  const me = useStaffProfile('me')
  const viewer = me.data?.viewer
  const whole = viewer?.organizationOverview === true
  const mine = !whole && viewer?.team === true
  const team = useTeam(mine)
  const organization = useOrganization(whole)
  const teamFigures = useTeamFigures(mine ? team.data : undefined)
  const directory = whole ? organization.data?.directory : undefined

  let figures: MastFigure[] = teamFigures
  if (directory) {
    const s = summarize(directory)
    figures = [
      { key: 'people', label: tx(T.staffAccounts), value: number(s.people), note: s.inactive > 0 ? tx(T.inactiveNote, { n: number(s.inactive) }) : undefined },
      { key: 'teams', label: tx(T.teams), value: number(s.teams) },
      { key: 'unplaced', label: tx(T.unassignedOption), value: number(s.unplaced), tone: s.unplaced === 0 ? 'quiet' : undefined },
      { key: 'incomplete', label: tx(T.incomplete), value: number(s.incomplete), tone: s.incomplete === 0 ? 'quiet' : undefined },
    ]
  }

  return (
    <div className="page dir sp-page sp-teampage">
      <div className="page__inner">
        <PageHeader title={tx(T.teamTitle)} subtitle={whole ? tx(T.directoryHint) : mine ? tx(T.myTeamHint) : undefined} figures={figures} />
        <QueryBoundary isLoading={me.isLoading} error={me.error} onRetry={() => void me.refetch()}>
          {whole ? (
            <QueryBoundary isLoading={organization.isLoading} error={organization.error} onRetry={() => void organization.refetch()}>
              {organization.data && (
                <>
                  {organization.data.directoryTruncated && <p className="notice dir-notice" role="status">{tx(T.truncated)}</p>}
                  <section className="sheet dir-sheet" aria-label={tx(T.tabDirectory)}>
                    <StaffTable rows={organization.data.directory} showManager />
                  </section>
                </>
              )}
            </QueryBoundary>
          ) : mine ? (
            <QueryBoundary
              isLoading={team.isLoading}
              error={team.error}
              isEmpty={(team.data?.members.length ?? 0) === 0}
              emptyTitle={tx(T.noTeam)}
              onRetry={() => void team.refetch()}
            >
              {team.data && (
                <section className="sheet dir-sheet" aria-label={tx(T.myTeam)}>
                  {/* What the masthead's sums are: exact, and a teacher counted once. */}
                  <StaffTable rows={team.data.members} showManager={false} note={tx(T.teamTotalsHint)} />
                </section>
              )}
            </QueryBoundary>
          ) : (
            <EmptyState icon="lock" title={tx(T.teamClosed)} />
          )}
        </QueryBoundary>
      </div>
    </div>
  )
}
