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
import { RecordHead, fill, useWalk, type Callout, type Highlight } from '@/features/profiles/RecordHead'
import { longDay } from '@/features/profiles/RecordParts'
import { countWords, type CountForms } from '@/features/instalments/copy'
import { EmptyState, ErrorState } from '@/shared/components/States'
import type { StaffProfile } from './api'
import { MISSING_LABEL, ROLE_LABEL, T, useCopy } from './copy'
import { useActivity, useStaffProfile } from './hooks'
import { AccountGroup, PersonalSection, PhotoBar, usePhotoDraft } from './PersonalSection'
import { ResponsibilitiesSection } from './ResponsibilitiesSection'
import { NumbersGroup, WORKLOAD_LABEL } from './WorkloadSection'
import { useTeamLoadNote } from './LoadAgainstTeam'
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
  const { locale, number } = useI18n()
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
  const highlights = useStaffHighlights(profile, showReports, own)

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
  const manager = profile.reportingManager
  // Someone else's file leads back to the list it was opened from, where the viewer has one.
  const back = own ? undefined : viewer.team || viewer.organizationOverview ? { to: '/team', label: tx(T.teamTitle) } : { to: '/profile', label: tx(T.myProfile) }
  const walk = useWalk('staff', profile.staffId, (id) => `/profile/${id}`)
  const startEdit = () => {
    openTab('overview')
    setEditing(true)
  }
  const callout = staffCallout({ profile, own, conversation, tx, locale, number, onEdit: mayEdit && !editing ? startEdit : null })
  // The chat the callout opens is not offered twice.
  const showEdit = mayEdit && !editing
  const showChat = !!conversation && callout?.uses !== 'chat'
  const sep = locale === 'ar' ? '، ' : ', '
  const titled = !!profile.jobTitle
  const line = (
    <>
      {titled && (
        <>
          <bdi>{profile.jobTitle}</bdi>
          {sep}
        </>
      )}
      {manager
        ? fill(tx(titled ? T.lineReportsTo : T.lineReportsToFirst), {
            // Only whoever sees the whole organization can be sure to open a manager's profile.
            name: viewer.organizationOverview ? (
              <Link to={`/profile/${manager.staffId}`}>
                <bdi>{manager.displayName}</bdi>
              </Link>
            ) : (
              <strong>
                <bdi>{manager.displayName}</bdi>
              </strong>
            ),
          })
        : tx(titled ? T.lineNoManager : T.lineNoManagerFirst)}
      {sep}
      {tx(T.lineJoined, { date: longDay(profile.joinedAt, locale) })}
    </>
  )

  return (
    <>
      <RecordHead
        back={back}
        walk={own ? null : walk}
        lead={
          photo.prepared ? (
            <img className="rec-lead__img" src={photo.prepared.previewUrl} alt={tx(T.photoPreview)} />
          ) : (
            <StaffAvatar name={profile.displayName} url={profile.avatarUrl} size="lead" />
          )
        }
        name={profile.displayName}
        status={
          profile.isActive ? (
            <Badge tone="ok">{tx(T.active)}</Badge>
          ) : (
            // Someone inactive who still holds families is a problem; otherwise it is only a fact.
            <Badge tone={profile.workload.assignedFamilies > 0 ? 'danger' : 'outline'}>{tx(T.inactive)}</Badge>
          )
        }
        line={line}
        highlights={highlights}
        callout={callout}
        actions={
          (showChat || showEdit || more.length > 0) && (
            <>
              {showChat && conversation && (
                // The view's one solid action; while the form is open that is its Save.
                <Link className={editing ? 'btn' : 'btn btn--primary'} to={`/chat/${encodeURIComponent(conversation.id)}`}>
                  <Icon name="conversations" size={16} />
                  {tx(T.chat)}
                </Link>
              )}
              {showEdit && (
                <button type="button" className="btn" onClick={startEdit}>
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
            <ResponsibilitiesSection profile={profile} refKey={refKey} />
            <PersonalSection profile={profile} refKey={refKey} editing={editing} onDone={() => setEditing(false)} />
          </div>
          <aside className="rec-aside">
            <NumbersGroup workload={profile.workload} asOf={profile.generatedAt} title={own ? T.workload : T.workloadOf} showDirectReports={showReports} />
            <AccountGroup profile={profile} completenessShown={own && callout?.uses !== 'edit'} />
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

const FAMILIES: CountForms = { en: ['{n} family', '{n} families'], ar: ['أسرة واحدة', 'أسرتين', '{n} أسر', '{n} أسرة'] }
const OPEN_CHATS: CountForms = {
  en: ['{n} open conversation', '{n} open conversations'],
  ar: ['محادثة مفتوحة واحدة', 'محادثتين مفتوحتين', '{n} محادثات مفتوحة', '{n} محادثة مفتوحة'],
}
const CHATS: CountForms = { en: ['{n} family chat', '{n} family chats'], ar: ['محادثة واحدة', 'محادثتان', '{n} محادثات', '{n} محادثة'] }

/**
 * What a manager needs at a glance about someone on their team: the families
 * and students they look after, the chats waiting for their reply, when they
 * were last active, their role, and (for someone others report to) their
 * direct reports. Overdue tasks have no per-person source yet; they are not
 * shown rather than shown as a nought.
 */
function useStaffHighlights(profile: StaffProfile, showReports: boolean, own: boolean): Highlight[] {
  const tx = useCopy()
  const { number, duration, locale } = useI18n()
  const w = profile.workload
  // How their families compare with the people beside them (a manager's view): one line, not a chart.
  const load = useTeamLoadNote(profile)
  const out: Highlight[] = [
    {
      key: 'assignedFamilies',
      icon: 'parents',
      label: tx(WORKLOAD_LABEL.assignedFamilies),
      value: number(w.assignedFamilies),
      note: own ? undefined : (load ?? undefined),
      tone: w.assignedFamilies === 0 ? 'quiet' : undefined,
    },
    { key: 'students', icon: 'students', label: tx(WORKLOAD_LABEL.studentsInAssignedFamilies), value: number(w.studentsInAssignedFamilies), tone: w.studentsInAssignedFamilies === 0 ? 'quiet' : undefined },
    {
      key: 'awaiting',
      icon: 'conversations',
      label: tx(T.hlAwaiting),
      value: number(w.awaitingReply),
      note: w.openConversations > 0 ? tx(T.hlAwaitingOf, { n: countWords(w.openConversations, OPEN_CHATS, locale) }) : undefined,
      tone: w.awaitingReply > 0 ? 'waiting' : 'quiet',
    },
  ]
  // One's own last activity is now; it is a fact about someone else.
  if (!own) {
    out.push({
      key: 'active',
      icon: 'history',
      label: tx(T.hlLastActive),
      value: profile.lastActivityAt ? duration(profile.lastActivityAt) : <span className="rec-hl__none">{tx(T.hlNoActivity)}</span>,
      text: true,
    })
  }
  out.push({ key: 'role', icon: 'briefcase', label: tx(T.hlRole), value: tx(ROLE_LABEL[profile.role] ?? { en: profile.role, ar: profile.role }), text: true })
  if (showReports) {
    out.push({ key: 'reports', icon: 'teams', label: tx(WORKLOAD_LABEL.directReports), value: number(w.directReports), tone: w.directReports === 0 ? 'quiet' : undefined })
  }
  return out
}

/**
 * The one thing about this person that needs someone now: an inactive
 * account still holding families, then chats waiting for their reply, then
 * (on one's own profile) the parts of the profile still missing.
 */
function staffCallout({
  profile,
  own,
  conversation,
  tx,
  locale,
  number,
  onEdit,
}: {
  profile: StaffProfile
  own: boolean
  conversation: ChatConversation | null
  tx: ReturnType<typeof useCopy>
  locale: 'ar' | 'en'
  number: (n: number) => string
  onEdit: (() => void) | null
}): (Callout & { uses?: 'chat' | 'edit' }) | null {
  const w = profile.workload
  const first = profile.displayName.split(/\s+/)[0] ?? profile.displayName
  if (!profile.isActive && w.assignedFamilies > 0) {
    const manages = profile.viewer.team || profile.viewer.organizationOverview
    return {
      tone: 'urgent',
      title: tx(T.calloutInactiveFamilies, { n: countWords(w.assignedFamilies, FAMILIES, locale) }),
      body: tx(T.calloutInactiveBody),
      action: manages ? (
        <Link className="btn btn--sm" to="/organization">
          {tx(T.handOver)}
        </Link>
      ) : undefined,
    }
  }
  if (w.awaitingReply > 0) {
    const chats = countWords(w.awaitingReply, CHATS, locale)
    if (own) {
      return {
        tone: 'waiting',
        title: tx(T.calloutAwaitingOwn, { n: chats }),
        action: (
          <Link className="btn btn--sm" to="/chat?view=waiting">
            {tx(T.openWaiting)}
          </Link>
        ),
      }
    }
    return {
      tone: 'waiting',
      title: fill(tx(T.calloutAwaitingOther, { n: chats }), { name: <bdi>{profile.displayName}</bdi> }),
      uses: conversation ? 'chat' : undefined,
      action: conversation ? (
        <Link className="btn btn--sm" to={`/chat/${encodeURIComponent(conversation.id)}`}>
          <Icon name="conversations" size={16} />
          {fill(tx(T.messageThem), { name: <bdi>{first}</bdi> })}
        </Link>
      ) : undefined,
    }
  }
  const { complete, total, missing } = profile.completeness
  if (own && missing.length > 0 && onEdit) {
    return {
      tone: 'waiting',
      title: tx(T.calloutIncomplete, { done: number(complete), total: number(total) }),
      body: tx(T.calloutIncompleteBody, { what: missing.map((m) => tx(MISSING_LABEL[m])).join(locale === 'ar' ? '، ' : ', ') }),
      uses: 'edit',
      action: (
        <button type="button" className="btn btn--sm" onClick={onEdit}>
          <Icon name="pencil" size={16} />
          {tx(T.completeProfile)}
        </button>
      ),
    }
  }
  return null
}
