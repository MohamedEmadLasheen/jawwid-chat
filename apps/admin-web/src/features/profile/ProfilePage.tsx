import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/core/api/errors'
import { useSession } from '@/core/auth/SessionProvider'
import { useI18n } from '@/core/i18n/I18nProvider'
import { canOpenArea, isSuperAdmin } from '@/core/permissions/capabilities'
import { chatApi, chatKeys, type ChatConversation } from '@/features/chat/chatApi'
import { PresencePrivacy } from '@/features/chat/PresencePrivacy'
import { MyDevices } from '@/features/devices/DevicesPage'
import { D as DEVICES } from '@/features/devices/copy'
import { RecordPanel, RecordTabs, useRecordTab, type RecordTab } from '@/features/profiles/RecordTabs'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { Menu, type MenuItem } from '@/shared/components/Menu'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, ErrorState } from '@/shared/components/States'
import type { StaffProfile } from './api'
import { ROLE_LABEL, T, useCopy } from './copy'
import { useActivity, useStaffProfile } from './hooks'
import { AccountGroup, PersonalSection, PhotoBar, usePhotoDraft } from './PersonalSection'
import { ResponsibilitiesSection } from './ResponsibilitiesSection'
import { NumbersGroup, useWorkloadFigures } from './WorkloadSection'
import { LoadAgainstTeam } from './LoadAgainstTeam'
import { ActivitySection } from './ActivitySection'
import { ActionLogSection } from './ActionLogSection'
import { TeamSection } from './TeamSection'
import { OrganizationPanel } from './OrganizationPanel'
import { ReportingLineDialog } from './ReportingLineDialog'
import { StaffAvatar } from './StaffAvatar'
import './profile.css'

type TabKey = 'overview' | 'activity' | 'team' | 'organization' | 'devices' | 'privacy'
/** A link's hash may name a section; it opens the tab that section sits in. */
const SECTION_TAB: Record<string, TabKey> = {
  load: 'overview',
  responsibilities: 'overview',
  personal: 'overview',
  account: 'overview',
  numbers: 'overview',
  'action-log': 'activity',
  audit: 'activity',
}

/**
 * `/profile` (the viewer's own) and `/profile/:staffId` (someone else's).
 *
 * A record with tabs, ONE page for every role. Which tabs and controls appear
 * is decided by the server's answer -- `access` for this profile, `viewer` for
 * what else the viewer may open -- not by a role string held in the browser:
 *
 *   masthead      who they are, the four counts that matter, Chat / Edit / more
 *   Overview      load against the team, responsibilities, their own words;
 *                 beside them the account facts and what the numbers count
 *   Activity      what they did (PD-35 B7) and, when access.canReadAudit, the
 *                 profile's audit records
 *   My team       a manager's own (viewer.team)
 *   Organization  the super admin's own (viewer.organizationOverview)
 *   Devices & sessions, Privacy   one's own profile only (PD-23, PD-37)
 *
 * The URL names only WHICH profile to ask for, and which tab is open. Whether
 * it can be seen, and what can be changed on it, is the server's decision on
 * every request.
 */
export function ProfilePage() {
  const { staffId } = useParams<{ staffId?: string }>()
  const ref = staffId ?? 'me'
  const tx = useCopy()
  const query = useStaffProfile(ref)
  const profile = query.data

  if (profile) {
    return (
      <div className="page pp rec sp-page">
        <div className="page__inner">
          <StaffFile key={profile.staffId} profile={profile} refKey={ref} />
        </div>
      </div>
    )
  }

  const title = tx(staffId ? T.profileOf : T.myProfile)
  const back = staffId ? { to: '/profile', label: tx(T.myProfile) } : undefined
  if (query.isLoading) {
    // Shapes, not a spinner: the layout does not jump when the data lands.
    return (
      <div className="page pp rec sp-page" aria-busy="true">
        <div className="page__inner">
          <PageHeader back={back} title={title} />
          <span className="sr-only" role="status">{title}…</span>
          <div className="split rec-split">
            <div className="rec-main">
              <div className="sp-skeleton" style={{ blockSize: 132 }} />
              <div className="sp-skeleton" style={{ blockSize: 180 }} />
            </div>
            <div className="sp-skeleton" style={{ blockSize: 220 }} />
          </div>
        </div>
      </div>
    )
  }
  const notFound = query.error instanceof ApiError && query.error.isNotFound
  return (
    <div className="page pp rec sp-page">
      <div className="page__inner">
        <PageHeader back={back} title={title} />
        {notFound ? <EmptyState icon="lock" title={tx(T.notFound)} /> : <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      </div>
    </div>
  )
}

function StaffFile({ profile, refKey }: { profile: StaffProfile; refKey: string }) {
  const tx = useCopy()
  const { date } = useI18n()
  const { access, viewer } = profile
  const own = access.relation === 'self'
  const activity = useActivity(refKey, access.canReadAudit)
  const conversation = useStaffChat(profile.staffId, !own)
  // PD-37: the Privacy tab is offered once the server has answered the viewer's own setting.
  const privacy = useQuery({ queryKey: chatKeys.presenceSettings, queryFn: chatApi.presenceSettings, enabled: own })
  const photo = usePhotoDraft(profile, refKey)
  const [changingManager, setChangingManager] = useState(false)
  const [editing, setEditing] = useState(false)
  // Whether the server lets this viewer read the action log; until it answers, whoever stands in a relation is assumed to.
  const [logReadable, setLogReadable] = useState<boolean | null>(null)

  const showReports = profile.role === 'manager' || profile.role === 'super_admin' || profile.workload.directReports > 0
  const figures = useWorkloadFigures(profile.workload, showReports)

  const showActivity = access.canReadAudit || (logReadable ?? access.relation !== 'none')
  const showTeam = own && viewer.team && profile.role === 'manager'
  const showOrganization = own && viewer.organizationOverview
  const showPrivacy = own && !!privacy.data
  const tabs: Array<RecordTab<TabKey>> = [
    { key: 'overview', label: tx(T.recOverview) },
    ...(showActivity ? [{ key: 'activity' as const, label: tx(T.recActivity) }] : []),
    ...(showTeam ? [{ key: 'team' as const, label: tx(T.myTeam) }] : []),
    ...(showOrganization ? [{ key: 'organization' as const, label: tx(T.recOrganization) }] : []),
    ...(own ? [{ key: 'devices' as const, label: tx(DEVICES.open) }] : []),
    ...(showPrivacy ? [{ key: 'privacy' as const, label: tx(T.recPrivacy) }] : []),
  ]
  const { tab, open: openTab } = useRecordTab<TabKey>(tabs.map((t) => t.key), SECTION_TAB)
  // A tab's page is asked for when it is first opened, and then stays.
  const opened = useRef(new Set<TabKey>())
  opened.current.add(tab)
  const was = (key: TabKey) => opened.current.has(key)

  // The form opens in "Personal profile", on Overview: bring that sheet to the top of the view.
  useEffect(() => {
    if (!editing) return
    const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById('sp-personal')?.closest('section')?.scrollIntoView?.({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
  }, [editing])

  const mayEdit = access.canEditProfessional || access.canEditDisplayName
  const canPhoto = access.canEditPhoto
  // Everything else that can be done to the file, in the order it is read; removing comes last.
  const more: MenuItem[] = [
    ...(canPhoto ? [{ key: 'photo', label: photo.label, icon: 'imageSquare' as const, onSelect: photo.pick }] : []),
    ...(access.canManageReportingLine
      ? [{ key: 'manager', label: tx(T.changeManager), icon: 'swap' as const, onSelect: () => setChangingManager(true) }]
      : []),
    ...(canPhoto && profile.avatarUrl
      ? [{ key: 'photo-remove', label: tx(T.photoRemove), icon: 'trash' as const, danger: true, onSelect: photo.remove }]
      : []),
  ]
  const showEdit = mayEdit && !editing
  const manager = profile.reportingManager
  // Someone else's file leads back to the list it was opened from, where the viewer has one.
  const back = own ? undefined : viewer.team || viewer.organizationOverview ? { to: '/team', label: tx(T.teamTitle) } : { to: '/profile', label: tx(T.myProfile) }

  return (
    <>
      <PageHeader
        eyebrow={own ? tx(T.myProfile) : undefined}
        back={back}
        lead={
          photo.prepared ? (
            <img className="rec-lead__img" src={photo.prepared.previewUrl} alt={tx(T.photoPreview)} />
          ) : (
            <StaffAvatar name={profile.displayName} url={profile.avatarUrl} size="lead" />
          )
        }
        title={profile.displayName}
        status={
          profile.isActive ? (
            <Badge tone="ok">{tx(T.active)}</Badge>
          ) : (
            // Someone inactive who still holds families is a problem; otherwise it is only a fact.
            <Badge tone={profile.workload.assignedFamilies > 0 ? 'danger' : 'outline'}>{tx(T.inactive)}</Badge>
          )
        }
        subtitle={
          <span className="rec-sub sp-sub">
            <span>{tx(ROLE_LABEL[profile.role] ?? { en: profile.role, ar: profile.role })}</span>
            {/* A missing title is named once, in the completeness line; the masthead stays clean. */}
            {profile.jobTitle && <bdi>{profile.jobTitle}</bdi>}
            {manager && (
              <span>
                {tx(T.reportsToLine)}{' '}
                {/* Only whoever sees the whole organization can be sure to open a manager's profile. */}
                {viewer.organizationOverview ? (
                  <Link to={`/profile/${manager.staffId}`} className="sp-head__link">
                    <bdi>{manager.displayName}</bdi>
                  </Link>
                ) : (
                  <strong>
                    <bdi>{manager.displayName}</bdi>
                  </strong>
                )}
              </span>
            )}
            <span className="sp-sub__keep">{tx(T.joinedLine, { date: date(profile.joinedAt) })}</span>
          </span>
        }
        figures={figures}
        actions={
          (conversation || showEdit || more.length > 0) && (
            <>
              {conversation && (
                <Link className="btn btn--primary" to={`/chat/${encodeURIComponent(conversation.id)}`}>
                  <Icon name="conversations" size={16} />
                  {tx(T.chat)}
                </Link>
              )}
              {showEdit && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    openTab('overview')
                    setEditing(true)
                  }}
                >
                  <Icon name="pencil" size={16} />
                  {tx(T.edit)}
                </button>
              )}
              {more.length > 0 && <Menu label={tx(T.more, { name: profile.displayName })} items={more} triggerClassName="btn btn--icon" />}
            </>
          )
        }
        tabs={<RecordTabs name="sf" label={tx(own ? T.myProfile : T.profileOf)} tabs={tabs} value={tab} onChange={openTab} />}
      />
      {canPhoto && <PhotoBar photo={photo} />}

      <RecordPanel name="sf" tab="overview" value={tab}>
        <div className="split rec-split">
          <div className="rec-main">
            {!own && <LoadAgainstTeam profile={profile} />}
            <ResponsibilitiesSection profile={profile} refKey={refKey} />
            <PersonalSection profile={profile} refKey={refKey} editing={editing} onDone={() => setEditing(false)} />
          </div>
          <aside className="rec-aside">
            <AccountGroup profile={profile} />
            <NumbersGroup workload={profile.workload} asOf={profile.generatedAt} title={own ? T.workload : T.workloadOf} showDirectReports={showReports} />
          </aside>
        </div>
      </RecordPanel>

      {/* Always in the document, so the log is asked for once; its tab is offered only when there is something to read. */}
      <RecordPanel name="sf" tab="activity" value={tab}>
        <div className="rec-history sp-activity">
          {/* PD-35 B7: what they did -- shown when the server lets the viewer read it. */}
          <div className="rec-slot">
            <ActionLogSection staffId={profile.staffId} onReadable={setLogReadable} />
          </div>
          {access.canReadAudit && (
            <div className="rec-slot">
              <ActivitySection query={activity} />
            </div>
          )}
        </div>
      </RecordPanel>

      {showTeam && (
        <RecordPanel name="sf" tab="team" value={tab}>
          {was('team') && <TeamSection />}
        </RecordPanel>
      )}
      {showOrganization && (
        <RecordPanel name="sf" tab="organization" value={tab}>
          {was('organization') && <OrganizationPanel />}
        </RecordPanel>
      )}
      {own && (
        // PD-23: where this account is signed in -- one's own only. The same sheet is the page at /profile/devices.
        <RecordPanel name="sf" tab="devices" value={tab}>
          {was('devices') && <MyDevices />}
        </RecordPanel>
      )}
      {showPrivacy && (
        // PD-37: one's own presence privacy.
        <RecordPanel name="sf" tab="privacy" value={tab}>
          <div className="sp-privacy">
            <PresencePrivacy />
          </div>
        </RecordPanel>
      )}

      {changingManager && <ReportingLineDialog profile={profile} refKey={refKey} onClose={() => setChangingManager(false)} />}
    </>
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

/** "Chat" is offered when the viewer already has a direct chat with this person. Opening a new one is the chat page's. */
function useStaffChat(staffId: string, wanted: boolean): ChatConversation | null {
  const { staff } = useSession()
  const mayChat = wanted && !!staff && !isSuperAdmin(staff.role) && canOpenArea(staff.role, 'chat')
  const chats = useQuery({ queryKey: chatKeys.list, queryFn: chatApi.list, enabled: mayChat, staleTime: 30_000, retry: false })
  return mayChat ? staffChat(chats.data, staffId) : null
}
