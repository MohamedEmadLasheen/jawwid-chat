import { useI18n } from '@/core/i18n/I18nProvider'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { T, useCopy } from './copy'
import { useOrganization, useStaffProfile, useTeam } from './hooks'
import { StaffTable } from './StaffTable'
import { TeamTotals } from './TeamSection'
import './profile.css'

/**
 * Team: the staff a viewer may list, each linking to their profile.
 *
 * Nothing new is asked of the server. The viewer's own profile already says
 * what they may open (`viewer.team`, `viewer.organizationOverview`): a manager
 * gets the people whose reporting line names them (GET /staff-profiles/team),
 * the super admin the whole directory (GET /staff-profiles/organization).
 * Anyone else is told plainly; a staff profile still opens from a name.
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
  const shown = whole ? organization.data?.directory.length : mine ? team.data?.members.length : undefined

  return (
    <div className="page pp pp-list sp-page">
      <div className="page__inner">
        <PageHeader
          title={tx(T.teamTitle)}
          subtitle={whole ? tx(T.directoryHint) : mine ? tx(T.myTeamHint) : undefined}
          actions={shown !== undefined && <span className="pp-total">{tx(T.people, { n: number(shown) })}</span>}
        />
        <QueryBoundary isLoading={me.isLoading} error={me.error} onRetry={() => void me.refetch()}>
          {whole ? (
            <QueryBoundary isLoading={organization.isLoading} error={organization.error} onRetry={() => void organization.refetch()}>
              {organization.data && (
                <>
                  {organization.data.directoryTruncated && <p className="notice" role="status">{tx(T.truncated)}</p>}
                  <StaffTable rows={organization.data.directory} showManager />
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
                <>
                  <TeamTotals team={team.data} />
                  <StaffTable rows={team.data.members} showManager={false} />
                </>
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
