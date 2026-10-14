import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { EmptyState, ErrorState } from '@/shared/components/States'
import { MISSING_LABEL, T, useCopy } from './copy'
import { useActivity, useStaffProfile } from './hooks'
import { AccountSection, PersonalSection } from './PersonalSection'
import { ResponsibilitiesSection } from './ResponsibilitiesSection'
import { WorkloadSection } from './WorkloadSection'
import { ActivitySection } from './ActivitySection'
import { TeamSection } from './TeamSection'
import { OrganizationPanel } from './OrganizationPanel'
import { ReportingLineDialog } from './ReportingLineDialog'
import './profile.css'

/**
 * `/profile` (the viewer's own) and `/profile/:staffId` (someone else's).
 *
 * ONE page for every role. Which sections appear is decided by the server's
 * answer -- `access` for this profile, `viewer` for what else the viewer may
 * open -- not by a role string held in the browser:
 *
 *   everyone     personal profile, account facts, responsibilities, workload
 *   manager      + My team (viewer.team) and the team's profiles via links
 *   super admin  + the organization overview (viewer.organizationOverview)
 *   audit        activity, when access.canReadAudit
 *
 * The URL names only WHICH profile to ask for. Whether it can be seen, and
 * what can be changed on it, is the server's decision on every request.
 */
export function ProfilePage() {
  const { staffId } = useParams<{ staffId?: string }>()
  const ref = staffId ?? 'me'
  const tx = useCopy()
  const query = useStaffProfile(ref)
  const profile = query.data
  const own = profile?.access.relation === 'self'
  const activity = useActivity(ref, Boolean(profile?.access.canReadAudit))
  const [changingManager, setChangingManager] = useState(false)

  if (query.isLoading) return <ProfileSkeleton />
  if (query.error || !profile) {
    const notFound = query.error instanceof ApiError && query.error.isNotFound
    return (
      <div className="page sp-page">
        {notFound ? <EmptyState title={tx(T.notFound)} /> : <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {staffId && <Link to="/profile" className="btn btn--sm">{tx(T.back)}</Link>}
      </div>
    )
  }

  return (
    <div className="page sp-page">
      <header className="sp-header">
        <h1 className="page__title">{own ? tx(T.myProfile) : tx(T.profileOf)}</h1>
        {!own && <Link to="/profile" className="btn btn--sm">{tx(T.back)}</Link>}
      </header>

      <Completeness missing={profile.completeness.missing} done={profile.completeness.complete} total={profile.completeness.total} />

      <div className="sp-grid">
        <div className="sp-col">
          <PersonalSection profile={profile} refKey={ref} />
          <ResponsibilitiesSection profile={profile} refKey={ref} />
        </div>
        <div className="sp-col">
          <AccountSection profile={profile} />
          {profile.access.canManageReportingLine && (
            <div className="sp-inline-action">
              <button type="button" className="btn btn--sm" onClick={() => setChangingManager(true)}>
                {tx(T.changeManager)}
              </button>
            </div>
          )}
          <WorkloadSection
            workload={profile.workload}
            asOf={profile.generatedAt}
            title={own ? T.workload : T.workloadOf}
            showDirectReports={profile.role === 'manager' || profile.role === 'super_admin' || profile.workload.directReports > 0}
          />
          {profile.access.canReadAudit && <ActivitySection query={activity} />}
        </div>
      </div>

      {own && profile.viewer.team && profile.role === 'manager' && <TeamSection />}
      {own && profile.viewer.organizationOverview && <OrganizationPanel />}

      {changingManager && (
        <ReportingLineDialog profile={profile} refKey={ref} onClose={() => setChangingManager(false)} />
      )}
    </div>
  )
}

function Completeness({ missing, done, total }: { missing: Array<keyof typeof MISSING_LABEL>; done: number; total: number }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const pct = total === 0 ? 100 : Math.round((done / total) * 100)
  return (
    <div className="sp-completeness" role="status">
      <div className="sp-completeness__bar" aria-hidden="true">
        <span style={{ inlineSize: `${pct}%` }} />
      </div>
      <span>
        {tx(T.completeness)}: {tx(T.completeCount, { done, total })}
        {missing.length > 0 && (
          <span className="sp-muted"> — {missing.map((m) => tx(MISSING_LABEL[m])).join(locale === 'ar' ? '، ' : ', ')}</span>
        )}
      </span>
    </div>
  )
}

/** Shapes, not a spinner: the layout does not jump when the data lands. */
function ProfileSkeleton() {
  const tx = useCopy()
  return (
    <div className="page sp-page" aria-busy="true">
      <span className="sr-only" role="status">{tx(T.myProfile)}…</span>
      <div className="sp-grid">
        <div className="sp-col">
          <div className="card sp-card sp-skeleton" style={{ blockSize: 260 }} />
          <div className="card sp-card sp-skeleton" style={{ blockSize: 160 }} />
        </div>
        <div className="sp-col">
          <div className="card sp-card sp-skeleton" style={{ blockSize: 200 }} />
          <div className="card sp-card sp-skeleton" style={{ blockSize: 220 }} />
        </div>
      </div>
    </div>
  )
}
