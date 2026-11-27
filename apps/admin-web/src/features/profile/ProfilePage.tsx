import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/core/api/errors'
import { useSession } from '@/core/auth/SessionProvider'
import { canOpenArea, isSuperAdmin } from '@/core/permissions/capabilities'
import { chatApi, chatKeys, type ChatConversation } from '@/features/chat/chatApi'
import { Icon } from '@/shared/components/Icon'
import { EmptyState, ErrorState } from '@/shared/components/States'
import { T, useCopy } from './copy'
import { useActivity, useStaffProfile } from './hooks'
import { AccountSection, PersonalSection, ProfileHead } from './PersonalSection'
import { ResponsibilitiesSection } from './ResponsibilitiesSection'
import { WorkloadSection } from './WorkloadSection'
import { LoadAgainstTeam } from './LoadAgainstTeam'
import { ActivitySection } from './ActivitySection'
import { ActionLogSection } from './ActionLogSection'
import { TeamSection } from './TeamSection'
import { OrganizationPanel } from './OrganizationPanel'
import { ReportingLineDialog } from './ReportingLineDialog'
import { D as DEVICES } from '@/features/devices/copy'
import './profile.css'
import { PresencePrivacy } from '@/features/chat/PresencePrivacy'

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
 *   action log   what they did (PD-35 B7), when the server answers it
 *
 * The URL names only WHICH profile to ask for. Whether it can be seen, and
 * what can be changed on it, is the server's decision on every request.
 *
 * Read top to bottom the way a manager reads a person: who they are, a ledger
 * of what they carry, then the work (their load against the team, their own
 * words, what they did) beside the official record (responsibilities, account).
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
  const [editing, setEditing] = useState(false)

  // The form opens in "Personal profile", further down: bring it into view.
  useEffect(() => {
    if (editing) document.getElementById('sp-personal')?.scrollIntoView?.({ block: 'nearest' })
  }, [editing])

  if (query.isLoading) return <ProfileSkeleton />
  if (query.error || !profile) {
    const notFound = query.error instanceof ApiError && query.error.isNotFound
    return (
      <div className="page pp sp-page">
        <div className="page__inner">
          {notFound ? <EmptyState title={tx(T.notFound)} /> : <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
          {staffId && <Link to="/profile" className="btn btn--sm">{tx(T.back)}</Link>}
        </div>
      </div>
    )
  }

  const mayEdit = profile.access.canEditProfessional || profile.access.canEditDisplayName

  return (
    <div className="page pp sp-page">
      <div className="page__inner">
        {own ? (
          // PD-23: where this account is signed in is the profile's second tab -- one's own only.
          <nav className="seg sp-tabsbar" aria-label={tx(T.tabs)}>
            <span className="seg__item" aria-current="page">{tx(T.tabProfile)}</span>
            <Link to="/profile/devices" className="seg__item">{tx(DEVICES.open)}</Link>
          </nav>
        ) : (
          <p className="pp-back">
            <Link to="/profile">{tx(T.back)}</Link>
          </p>
        )}

        <ProfileHead
          profile={profile}
          refKey={ref}
          heading={own ? tx(T.myProfile) : tx(T.profileOf)}
          actions={
            (!own || (mayEdit && !editing)) && (
              <>
                {!own && <ChatWith staffId={profile.staffId} />}
                {mayEdit && !editing && (
                  <button type="button" className="btn btn--sm" onClick={() => setEditing(true)}>
                    {tx(T.edit)}
                  </button>
                )}
              </>
            )
          }
        />

        <WorkloadSection
          workload={profile.workload}
          asOf={profile.generatedAt}
          title={own ? T.workload : T.workloadOf}
          showDirectReports={profile.role === 'manager' || profile.role === 'super_admin' || profile.workload.directReports > 0}
        />

        <div className="pp-cols">
          <div className="pp-main">
            {!own && <LoadAgainstTeam profile={profile} />}
            <PersonalSection profile={profile} refKey={ref} editing={editing} onDone={() => setEditing(false)} />
            {/* PD-35 B7: what they did -- shown when the server lets the viewer read it. */}
            <ActionLogSection staffId={profile.staffId} />
            {profile.access.canReadAudit && <ActivitySection query={activity} />}
          </div>
          <aside className="pp-side">
            <ResponsibilitiesSection profile={profile} refKey={ref} />
            <AccountSection
              profile={profile}
              action={
                profile.access.canManageReportingLine && (
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setChangingManager(true)}>
                    {tx(T.changeManager)}
                  </button>
                )
              }
            />
            {/* PD-37: one's own presence privacy. */}
            {own && <PresencePrivacy />}
          </aside>
        </div>

        {own && profile.viewer.team && profile.role === 'manager' && <TeamSection />}
        {own && profile.viewer.organizationOverview && <OrganizationPanel />}

        {changingManager && (
          <ReportingLineDialog profile={profile} refKey={ref} onClose={() => setChangingManager(false)} />
        )}
      </div>
    </div>
  )
}

/** The viewer's own direct chat with this staff member, among the conversations they already have. */
function staffChat(list: ChatConversation[] | undefined, staffId: string): ChatConversation | null {
  return (
    (list ?? []).find(
      (c) =>
        c.type === 'direct' &&
        !c.archivedAt &&
        !c.familyId &&
        !c.learnerId &&
        c.members?.some((m) => m.actorKind === 'staff' && m.actorId === staffId) === true &&
        c.members.every((m) => m.actorKind === 'staff'),
    ) ?? null
  )
}

/** "Chat": offered when the viewer already has a direct chat with this person. Opening a new one is the chat page's. */
function ChatWith({ staffId }: { staffId: string }) {
  const tx = useCopy()
  const { staff } = useSession()
  const mayChat = !!staff && !isSuperAdmin(staff.role) && canOpenArea(staff.role, 'chat')
  const chats = useQuery({ queryKey: chatKeys.list, queryFn: chatApi.list, enabled: mayChat, staleTime: 30_000, retry: false })
  const conversation = mayChat ? staffChat(chats.data, staffId) : null
  if (!conversation) return null
  return (
    <Link className="btn btn--sm" to={`/chat/${encodeURIComponent(conversation.id)}`}>
      <Icon name="conversations" size={16} />
      {tx(T.chat)}
    </Link>
  )
}

/** Shapes, not a spinner: the layout does not jump when the data lands. */
function ProfileSkeleton() {
  const tx = useCopy()
  return (
    <div className="page pp sp-page" aria-busy="true">
      <div className="page__inner">
        <span className="sr-only" role="status">{tx(T.myProfile)}…</span>
        <div className="sp-skeleton" style={{ blockSize: 96 }} />
        <div className="sp-skeleton" style={{ blockSize: 88 }} />
        <div className="pp-cols">
          <div className="pp-main">
            <div className="sp-skeleton" style={{ blockSize: 220 }} />
          </div>
          <div className="pp-side">
            <div className="sp-skeleton" style={{ blockSize: 180 }} />
          </div>
        </div>
      </div>
    </div>
  )
}
