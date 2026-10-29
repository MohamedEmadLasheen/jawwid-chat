import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import { adminSectionPath } from '@/features/admin/sections'
import type { OrganizationOverview, ProfilePerson } from './api'
import { CATEGORY_LABEL, MISSING_LABEL, ROLE_LABEL, T, labelFor, useCopy, type Pair } from './copy'
import { ActivityList } from './ActivitySection'
import { useOrganization } from './hooks'
import { StaffAvatar } from './StaffAvatar'
import { StaffTable } from './StaffTable'
import { Total } from './TeamSection'
import { RESPONSIBILITY_CATEGORIES } from './api'

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
 * The super admin's master profile: organization, directory, responsibilities,
 * workload, health and activity. Requested only when the server's own profile
 * answer says `viewer.organizationOverview`, and refused server-side to anyone
 * else. Every number is its own server-side count; this component adds nothing
 * up except where the label says "summed across teams".
 */
export function OrganizationPanel() {
  const tx = useCopy()
  const org = useOrganization(true)
  const [tab, setTab] = useState<Tab>('overview')

  return (
    <section className="card sp-card sp-org" aria-labelledby="sp-org">
      <h2 id="sp-org" className="sp-card__title">{tx(T.organization)}</h2>
      <p className="sp-footnote">{tx(T.organizationHint)}</p>
      <div className="sp-tabs" role="tablist" aria-label={tx(T.organization)}>
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
            onKeyDown={(e) => {
              const i = TABS.findIndex((x) => x.key === tab)
              const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
              if (!step) return
              // Arrow keys follow reading direction: in RTL "right" is backwards.
              const dir = document.documentElement.dir === 'rtl' ? -step : step
              const next = TABS[(i + dir + TABS.length) % TABS.length]
              if (!next) return
              setTab(next.key)
              document.getElementById(`sp-tab-${next.key}`)?.focus()
            }}
          >
            {tx(t.label)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`sp-panel-${tab}`} aria-labelledby={`sp-tab-${tab}`} className="sp-tabpanel">
        <QueryBoundary isLoading={org.isLoading} error={org.error} onRetry={() => void org.refetch()}>
          {org.data && <Panel tab={tab} data={org.data} onTab={setTab} />}
        </QueryBoundary>
      </div>
      <QuickActions onTab={setTab} />
    </section>
  )
}

function Panel({ tab, data, onTab }: { tab: Tab; data: OrganizationOverview; onTab: (t: Tab) => void }) {
  switch (tab) {
    case 'overview':
      return <Overview data={data} onTab={onTab} />
    case 'directory':
      return (
        <>
          {data.directoryTruncated && <Truncated />}
          <StaffTable rows={data.directory} showManager />
        </>
      )
    case 'coverage':
      return <Coverage data={data} />
    case 'workload':
      return <Workload data={data} />
    case 'health':
      return <Health data={data} />
    case 'activity':
      return <ActivityList entries={data.recentActivity} showTarget />
  }
}

function Truncated() {
  const tx = useCopy()
  return <div className="banner banner--warn" role="status">{tx(T.truncated)}</div>
}

function Overview({ data, onTab }: { data: OrganizationOverview; onTab: (t: Tab) => void }) {
  const tx = useCopy()
  const { number, dateTime } = useI18n()
  const a = data.accounts
  return (
    <>
      <div className="sp-totals">
        <button type="button" className="sp-total sp-total--link" onClick={() => onTab('directory')}>
          <div className="sp-total__value">{number(a.managers)}</div>
          <div className="sp-total__label">{tx(T.managers)}</div>
        </button>
        <button type="button" className="sp-total sp-total--link" onClick={() => onTab('directory')}>
          <div className="sp-total__value">{number(a.adminsAndSupervisors)}</div>
          <div className="sp-total__label">{tx(T.adminsSupervisors)}</div>
        </button>
        <Total label={tx(T.activeAccounts)} value={number(a.active)} />
        <Total label={tx(T.inactiveAccounts)} value={number(a.inactive)} />
        <button type="button" className="sp-total sp-total--link" onClick={() => onTab('health')}>
          <div className="sp-total__value">{number(a.withoutLogin)}</div>
          <div className="sp-total__label">{tx(T.withoutLogin)}</div>
        </button>
      </div>

      <h3 className="sp-subtitle">{tx(T.byRole)}</h3>
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

      <h3 className="sp-subtitle">{tx(T.teams)}</h3>
      {data.teams.length === 0 ? (
        <p className="sp-muted">{tx(T.noTeams)}</p>
      ) : (
        <ul className="sp-rows">
          {data.teams.map((t) => (
            <li key={t.manager.staffId} className="sp-row sp-row--compact">
              <div className="sp-row__who">
                <StaffAvatar name={t.manager.displayName} url={t.manager.avatarUrl} size={36} />
                <div className="sp-row__names">
                  <Link to={`/profile/${t.manager.staffId}`} className="sp-row__link">{t.manager.displayName}</Link>
                  <div className="sp-muted sp-small">{tx(T.members, { n: number(t.memberCount) })}</div>
                </div>
              </div>
              <dl className="sp-row__nums">
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
      <p className="sp-footnote">{tx(T.asOf, { when: dateTime(data.generatedAt) })}</p>
    </>
  )
}

function Coverage({ data }: { data: OrganizationOverview }) {
  const tx = useCopy()
  const held = new Map(data.responsibilityCoverage.map((c) => [c.category, c.holders]))
  return (
    <>
      <p className="sp-footnote">{tx(T.responsibilitiesHint)}</p>
      <ul className="sp-list">
        {RESPONSIBILITY_CATEGORIES.map((c) => {
          const holders = held.get(c) ?? []
          return (
            <li key={c} className="sp-list__item sp-coverage">
              <strong>{tx(labelFor(CATEGORY_LABEL, c))}</strong>
              {holders.length === 0 ? (
                <span className="sp-muted sp-small">{tx(T.nobodyHolds)}</span>
              ) : (
                <span className="sp-small">
                  {tx(T.holders)}:{' '}
                  {holders.map((h, i) => (
                    <span key={h.staffId}>
                      {i > 0 && ' · '}
                      <Link to={`/profile/${h.staffId}`}>{h.displayName}</Link>
                    </span>
                  ))}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

function Workload({ data }: { data: OrganizationOverview }) {
  const tx = useCopy()
  const { number } = useI18n()
  const u = data.workload.unique
  const s = data.workload.sumOfTeams
  return (
    <>
      <h3 className="sp-subtitle">{tx(T.uniqueTotals)}</h3>
      <div className="sp-totals">
        <Total label={tx(T.colFamilies)} value={number(u.families)} />
        <Total label={tx(T.colStudents)} value={number(u.studentsInFamilies)} />
        <Total label={tx({ en: 'Parent contacts', ar: 'جهات اتصال الأسر' })} value={number(u.activeParentContacts)} />
        <Total label={tx(T.activeTeachers)} value={number(u.activeTeachers)} />
        <Total label={tx(T.teachersWithStudents)} value={number(u.teachersWithStudents)} />
        <Total label={tx(T.colOpen)} value={number(u.openConversations)} />
        <Total label={tx(T.colAwaiting)} value={number(u.awaitingReply)} />
        <Total label={tx(T.colApprovals)} value={number(u.pendingApprovals)} />
      </div>
      <h3 className="sp-subtitle">{tx(T.sumOfTeams)}</h3>
      <div className="sp-totals">
        <Total label={tx(T.colFamilies)} value={number(s.assignedFamilies)} />
        <Total label={tx(T.colStudents)} value={number(s.studentsInAssignedFamilies)} />
        <Total label={tx(T.colOpen)} value={number(s.openConversations)} />
        <Total label={tx(T.colApprovals)} value={number(s.pendingApprovals)} />
        <Total label={tx(T.outsideTeams)} value={number(data.workload.familiesOutsideTeams)} />
      </div>
      <p className="sp-footnote">{tx(T.teamTotalsHint)}</p>
      <div className="sp-untracked" role="note">
        <strong>{tx(T.notTracked)}</strong>
        <div>{tx(T.notTrackedBody)}</div>
      </div>
    </>
  )
}

function PeopleList({ people, extra }: { people: ProfilePerson[]; extra?: (p: ProfilePerson) => string | null }) {
  const tx = useCopy()
  if (people.length === 0) return <p className="sp-ok">{tx(T.allClear)}</p>
  return (
    <ul className="sp-list">
      {people.map((p) => (
        <li key={p.staffId} className="sp-list__item sp-person">
          <StaffAvatar name={p.displayName} url={p.avatarUrl} size={28} />
          <Link to={`/profile/${p.staffId}`}>{p.displayName}</Link>
          <span className="sp-muted sp-small">{tx(ROLE_LABEL[p.role] ?? { en: p.role, ar: p.role })}</span>
          {extra?.(p) && <span className="sp-small">{extra(p)}</span>}
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
  return (
    <>
      <h3 className="sp-subtitle">{tx(T.noReportingLine)} ({number(h.withoutReportingLine.length)})</h3>
      <PeopleList people={h.withoutReportingLine} />
      <h3 className="sp-subtitle">{tx(T.incomplete)} ({number(h.incompleteProfiles.length)})</h3>
      <PeopleList
        people={h.incompleteProfiles}
        extra={(p) => (missing.get(p.staffId) ?? []).map((m) => tx(MISSING_LABEL[m])).join(' · ')}
      />
      <h3 className="sp-subtitle">{tx(T.withoutLogin)} ({number(h.withoutLogin.length)})</h3>
      <PeopleList people={h.withoutLogin} />
      <h3 className="sp-subtitle">{tx(T.staleLines)} ({number(h.staleReportingLines.length)})</h3>
      <PeopleList people={h.staleReportingLines.map((l) => l.member)} />
      <h3 className="sp-subtitle">{tx(T.inactiveOwners)}</h3>
      <p className={h.familiesOwnedByInactiveStaff > 0 ? 'field__error' : 'sp-ok'}>{number(h.familiesOwnedByInactiveStaff)}</p>
    </>
  )
}

/** Links to screens that exist. A missing screen is named as missing, not linked. */
function QuickActions({ onTab }: { onTab: (t: Tab) => void }) {
  const tx = useCopy()
  return (
    <div className="sp-quick">
      <h3 className="sp-subtitle">{tx(T.quickActions)}</h3>
      <ul className="sp-list">
        <li className="sp-list__item">
          <button type="button" className="btn btn--sm" onClick={() => onTab('directory')}>{tx(T.qaDirectory)}</button>
        </li>
        <li className="sp-list__item">
          <button type="button" className="btn btn--sm" onClick={() => onTab('health')}>{tx(T.qaHealth)}</button>
        </li>
        <li className="sp-list__item">
          <Link to={adminSectionPath('users')} className="btn btn--sm">{tx(T.qaUsers)}</Link>
        </li>
        <li className="sp-list__item">
          <Link to="/accounts/staff" className="btn btn--sm">{tx(T.qaStaffAccounts)}</Link>
        </li>
        <li className="sp-list__item">
          <Link to="/accounts/roles" className="btn btn--sm">{tx(T.qaRoles)}</Link>
        </li>
        <li className="sp-list__item sp-muted sp-small">{tx(T.qaPermissions)}</li>
      </ul>
    </div>
  )
}
