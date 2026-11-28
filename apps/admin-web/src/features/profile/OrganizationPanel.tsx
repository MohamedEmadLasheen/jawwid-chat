import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { QueryBoundary } from '@/shared/components/States'
import { PLURAL, usePlural } from '@/features/admin/copy'
import { adminSectionPath } from '@/features/admin/sections'
import { Calm } from '@/features/profiles/RecordParts'
import type { OrganizationOverview, ProfilePerson } from './api'
import { RESPONSIBILITY_CATEGORIES } from './api'
import { CATEGORY_LABEL, MISSING_LABEL, ROLE_LABEL, T, labelFor, useCopy, type Pair } from './copy'
import { ActivityList } from './ActivitySection'
import { useOrganization } from './hooks'
import { StaffTable } from './StaffTable'
import { Total } from './TeamSection'

type Tab = 'overview' | 'directory' | 'coverage' | 'workload' | 'health' | 'activity'
const TABS: ReadonlyArray<{ key: Tab; label: Pair }> = [
  { key: 'overview', label: T.tabOverview },
  { key: 'directory', label: T.tabDirectory },
  { key: 'coverage', label: T.tabCoverage },
  { key: 'workload', label: T.tabWorkload },
  { key: 'health', label: T.tabHealth },
  { key: 'activity', label: T.tabActivity },
]

/**
 * The super admin's organization overview, a tab of their own profile:
 * organization, directory, responsibilities, workload, health and activity.
 * Requested only when the server's own profile answer says
 * `viewer.organizationOverview`, and refused server-side to anyone else. Every
 * number is its own server-side count; this component adds nothing up except
 * where the label says "summed across teams".
 *
 * Its six parts are a list of sections at the start, with ONE part's sheets
 * beside it; on a narrow screen the list is a strip above them.
 */
export function OrganizationPanel() {
  const tx = useCopy()
  const org = useOrganization(true)
  const [tab, setTab] = useState<Tab>('overview')

  const onKeyDown = (e: KeyboardEvent) => {
    const i = TABS.findIndex((x) => x.key === tab)
    // Left and right follow reading direction (in RTL "right" is backwards); down and up follow the list.
    const side = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    const along = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    const step = along || (document.documentElement.dir === 'rtl' ? -side : side)
    if (!step) return
    e.preventDefault()
    const next = TABS[(i + step + TABS.length) % TABS.length]
    if (!next) return
    setTab(next.key)
    document.getElementById(`sp-tab-${next.key}`)?.focus()
  }

  return (
    <section className="sp-org" aria-labelledby="sp-org">
      <div className="sp-org__nav">
        <h2 id="sp-org" className="aside-group__title">{tx(T.organization)}</h2>
        <div className="sp-tabs" role="tablist" aria-label={tx(T.organization)} onKeyDown={onKeyDown}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`sp-tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`sp-panel-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1}
              className="sp-tab"
              onClick={() => setTab(t.key)}
            >
              {tx(t.label)}
            </button>
          ))}
        </div>
        <p className="rec-rule sp-org__rule">{tx(T.organizationHint)}</p>
      </div>
      <div role="tabpanel" id={`sp-panel-${tab}`} aria-labelledby={`sp-tab-${tab}`} className="sp-tabpanel sp-org__main">
        <QueryBoundary isLoading={org.isLoading} error={org.error} onRetry={() => void org.refetch()}>
          {org.data && <Panel tab={tab} data={org.data} onTab={setTab} />}
        </QueryBoundary>
      </div>
      <QuickActions onTab={setTab} />
    </section>
  )
}

/** One sheet of a part: its heading, how many it holds, one quiet rule line. */
function OrgSheet({ title, count, rule, children }: { title: string; count?: ReactNode; rule?: string; children: ReactNode }) {
  return (
    <div className="sheet rec-sheet sp-org__sheet">
      <div className="sheet__head">
        <div className="rec-sheet__title">
          <h3 className="sheet__title">{title}</h3>
          {count !== undefined && count !== null && <span className="sheet__count">{count}</span>}
        </div>
      </div>
      {rule && <p className="rec-sheet__rule">{rule}</p>}
      {children}
    </div>
  )
}

function Panel({ tab, data, onTab }: { tab: Tab; data: OrganizationOverview; onTab: (t: Tab) => void }) {
  const tx = useCopy()
  switch (tab) {
    case 'overview':
      return <Overview data={data} onTab={onTab} />
    case 'directory':
      return (
        <>
          {data.directoryTruncated && <Truncated />}
          <div className="sheet dir-sheet">
            <StaffTable rows={data.directory} showManager />
          </div>
        </>
      )
    case 'coverage':
      return <Coverage data={data} />
    case 'workload':
      return <Workload data={data} />
    case 'health':
      return <Health data={data} />
    case 'activity':
      return (
        <OrgSheet title={tx(T.tabActivity)} rule={tx(T.activityHint)}>
          <ActivityList entries={data.recentActivity} showTarget />
        </OrgSheet>
      )
  }
}

function Truncated() {
  const tx = useCopy()
  return <p className="notice dir-notice" role="status">{tx(T.truncated)}</p>
}

function Overview({ data, onTab }: { data: OrganizationOverview; onTab: (t: Tab) => void }) {
  const tx = useCopy()
  const plural = usePlural()
  const { number, dateTime } = useI18n()
  const a = data.accounts
  return (
    <>
      <OrgSheet title={tx(T.staffAccounts)}>
        <div className="ledger sp-ledger">
          <button type="button" className="ledger__cell" onClick={() => onTab('directory')}>
            <div className="ledger__value">{number(a.managers)}</div>
            <div className="ledger__label">{tx(T.managers)}</div>
          </button>
          <button type="button" className="ledger__cell" onClick={() => onTab('directory')}>
            <div className="ledger__value">{number(a.adminsAndSupervisors)}</div>
            <div className="ledger__label">{tx(T.adminsSupervisors)}</div>
          </button>
          <Total label={tx(T.activeAccounts)} value={number(a.active)} />
          <Total label={tx(T.inactiveAccounts)} value={number(a.inactive)} />
          <button type="button" className="ledger__cell" onClick={() => onTab('health')}>
            <div className="ledger__value">{number(a.withoutLogin)}</div>
            <div className="ledger__label">{tx(T.withoutLogin)}</div>
          </button>
        </div>
      </OrgSheet>

      <div className="sp-org__pair">
        <OrgSheet title={tx(T.teams)} count={data.teams.length > 0 ? number(data.teams.length) : undefined}>
          {data.teams.length === 0 ? (
            <p className="rec-empty">{tx(T.noTeams)}</p>
          ) : (
            <ul className="sp-teams">
              {data.teams.map((t) => (
                <li key={t.manager.staffId} className="sp-teams__row">
                  <div className="dir-who">
                    <Avatar name={t.manager.displayName} seed={t.manager.staffId} src={t.manager.avatarUrl} />
                    <div className="dir-who__text">
                      <Link to={`/profile/${t.manager.staffId}`} className="dir-name sp-row__link">
                        <bdi>{t.manager.displayName}</bdi>
                      </Link>
                      <span className="dir-sub">
                        <span>{plural(PLURAL.people, t.memberCount)}</span>
                      </span>
                    </div>
                  </div>
                  <dl className="sp-teams__nums">
                    <div><dt>{tx(T.colFamilies)}</dt><dd>{number(t.totals.assignedFamilies)}</dd></div>
                    <div><dt>{tx(T.colStudents)}</dt><dd>{number(t.totals.studentsInAssignedFamilies)}</dd></div>
                    <div><dt>{tx(T.colTeachers)}</dt><dd>{number(t.distinctTeachers)}</dd></div>
                    <div><dt>{tx(T.colOpen)}</dt><dd>{number(t.totals.openConversations)}</dd></div>
                    <div><dt>{tx(T.colApprovals)}</dt><dd>{number(t.totals.pendingApprovals)}</dd></div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </OrgSheet>

        <OrgSheet title={tx(T.byRole)}>
          <dl className="sp-facts">
            {Object.entries(a.byRole).map(([role, v]) => (
              <div key={role} className="sp-facts__row">
                <dt>{tx(ROLE_LABEL[role] ?? { en: role, ar: role })}</dt>
                <dd>
                  {tx(T.active)} {number(v.active)} · {tx(T.inactive)} {number(v.inactive)}
                </dd>
              </div>
            ))}
          </dl>
        </OrgSheet>
      </div>
      <p className="sp-footnote">{tx(T.asOf, { when: dateTime(data.generatedAt) })}</p>
    </>
  )
}

function Coverage({ data }: { data: OrganizationOverview }) {
  const tx = useCopy()
  const { number } = useI18n()
  const held = new Map(data.responsibilityCoverage.map((c) => [c.category, c.holders]))
  const covered = RESPONSIBILITY_CATEGORIES.filter((c) => (held.get(c) ?? []).length > 0)
  const open = RESPONSIBILITY_CATEGORIES.filter((c) => (held.get(c) ?? []).length === 0)
  return (
    <OrgSheet title={tx(T.tabCoverage)} rule={tx(T.responsibilitiesHint)}>
      {/* The areas someone holds, with who; then the ones waiting on someone, together under one gold tag. */}
      {covered.length > 0 && (
        <ul className="sp-list sp-list--ruled">
          {covered.map((c) => (
            <li key={c} className="sp-list__item sp-coverage">
              <strong>{tx(labelFor(CATEGORY_LABEL, c))}</strong>
              <span className="sp-coverage__held">
                <span className="sp-muted">{tx(T.holders)}: </span>
                {(held.get(c) ?? []).map((h, i) => (
                  <span key={h.staffId}>
                    {i > 0 && ' · '}
                    <Link to={`/profile/${h.staffId}`}>
                      <bdi>{h.displayName}</bdi>
                    </Link>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open.length > 0 && (
        <div className="sp-uncovered">
          <p className="sp-uncovered__head">
            <Badge tone="gold">{tx(T.nobodyHolds)}</Badge>
            <span className="count count--quiet">{number(open.length)}</span>
          </p>
          <ul className="pp-tags">
            {open.map((c) => (
              <li key={c} className="pp-tag">{tx(labelFor(CATEGORY_LABEL, c))}</li>
            ))}
          </ul>
        </div>
      )}
    </OrgSheet>
  )
}

function Workload({ data }: { data: OrganizationOverview }) {
  const tx = useCopy()
  const { number } = useI18n()
  const u = data.workload.unique
  const s = data.workload.sumOfTeams
  return (
    <>
      <OrgSheet title={tx(T.uniqueTotals)}>
        <div className="ledger sp-ledger sp-ledger--wrap">
          <Total label={tx(T.colFamilies)} value={number(u.families)} />
          <Total label={tx(T.colStudents)} value={number(u.studentsInFamilies)} />
          <Total label={tx({ en: 'Parent contacts', ar: 'جهات اتصال الأسر' })} value={number(u.activeParentContacts)} />
          <Total label={tx(T.activeTeachers)} value={number(u.activeTeachers)} />
          <Total label={tx(T.teachersWithStudents)} value={number(u.teachersWithStudents)} />
          <Total label={tx(T.colOpen)} value={number(u.openConversations)} />
          <Total label={tx(T.colAwaiting)} value={number(u.awaitingReply)} />
          <Total label={tx(T.colApprovals)} value={number(u.pendingApprovals)} />
        </div>
      </OrgSheet>
      <OrgSheet title={tx(T.sumOfTeams)} rule={tx(T.teamTotalsHint)}>
        <div className="ledger sp-ledger">
          <Total label={tx(T.colFamilies)} value={number(s.assignedFamilies)} />
          <Total label={tx(T.colStudents)} value={number(s.studentsInAssignedFamilies)} />
          <Total label={tx(T.colOpen)} value={number(s.openConversations)} />
          <Total label={tx(T.colApprovals)} value={number(s.pendingApprovals)} />
          <Total label={tx(T.outsideTeams)} value={number(data.workload.familiesOutsideTeams)} />
        </div>
      </OrgSheet>
      <p className="rec-rule sp-org__note" role="note">
        <strong>{tx(T.notTracked)}</strong>
        <span>: {tx(T.notTrackedBody)}</span>
      </p>
    </>
  )
}

function PeopleList({ people, extra }: { people: ProfilePerson[]; extra?: (p: ProfilePerson) => string | null }) {
  const tx = useCopy()
  if (people.length === 0) return <Calm>{tx(T.allClear)}</Calm>
  return (
    <ul className="sp-list">
      {people.map((p) => (
        <li key={p.staffId} className="sp-list__item sp-person">
          <Avatar name={p.displayName} seed={p.staffId} src={p.avatarUrl} size="sm" />
          <Link to={`/profile/${p.staffId}`} className="dir-name sp-row__link">
            <bdi>{p.displayName}</bdi>
          </Link>
          <span className="sp-muted sp-small">{tx(ROLE_LABEL[p.role] ?? { en: p.role, ar: p.role })}</span>
          {extra?.(p) && <span className="sp-small sp-person__extra">{extra(p)}</span>}
        </li>
      ))}
    </ul>
  )
}

function Health({ data }: { data: OrganizationOverview }) {
  const tx = useCopy()
  const { number } = useI18n()
  const h = data.health
  const missing = new Map(h.incompleteProfiles.map((p) => [p.staffId, p.missing]))
  // A list with someone on it says how many, as a solid count; an empty one says nothing needs fixing.
  const count = (n: number) => (n > 0 ? <span className="count">{number(n)}</span> : undefined)
  return (
    <div className="sp-org__health">
      <OrgSheet title={tx(T.noReportingLine)} count={count(h.withoutReportingLine.length)}>
        <PeopleList people={h.withoutReportingLine} />
      </OrgSheet>
      <OrgSheet title={tx(T.incomplete)} count={count(h.incompleteProfiles.length)}>
        <PeopleList
          people={h.incompleteProfiles}
          extra={(p) => (missing.get(p.staffId) ?? []).map((m) => tx(MISSING_LABEL[m])).join(' · ')}
        />
      </OrgSheet>
      <OrgSheet title={tx(T.withoutLogin)} count={count(h.withoutLogin.length)}>
        <PeopleList people={h.withoutLogin} />
      </OrgSheet>
      <OrgSheet title={tx(T.staleLines)} count={count(h.staleReportingLines.length)}>
        <PeopleList people={h.staleReportingLines.map((l) => l.member)} />
      </OrgSheet>
      <OrgSheet title={tx(T.inactiveOwners)}>
        <p className={h.familiesOwnedByInactiveStaff > 0 ? 'sp-org__figure sp-org__figure--late' : 'sp-org__figure'}>
          {number(h.familiesOwnedByInactiveStaff)}
        </p>
      </OrgSheet>
    </div>
  )
}

/** Links to screens that exist. A missing screen is named as missing, not linked. */
function QuickActions({ onTab }: { onTab: (t: Tab) => void }) {
  const tx = useCopy()
  return (
    <div className="sp-quick">
      <h3 className="aside-group__title">{tx(T.quickActions)}</h3>
      <ul className="sp-quick__list">
        <li>
          <button type="button" className="sp-quick__link" onClick={() => onTab('directory')}>
            <span>{tx(T.qaDirectory)}</span>
          </button>
        </li>
        <li>
          <button type="button" className="sp-quick__link" onClick={() => onTab('health')}>
            <span>{tx(T.qaHealth)}</span>
          </button>
        </li>
        <li>
          <Link to={adminSectionPath('users')} className="sp-quick__link">
            <span>{tx(T.qaUsers)}</span>
            <Icon name="arrowForward" size={14} />
          </Link>
        </li>
        <li>
          <Link to="/accounts/staff" className="sp-quick__link">
            <span>{tx(T.qaStaffAccounts)}</span>
            <Icon name="arrowForward" size={14} />
          </Link>
        </li>
        <li>
          <Link to="/accounts/roles" className="sp-quick__link">
            <span>{tx(T.qaRoles)}</span>
            <Icon name="arrowForward" size={14} />
          </Link>
        </li>
      </ul>
      <p className="rec-rule">{tx(T.qaPermissions)}</p>
    </div>
  )
}
