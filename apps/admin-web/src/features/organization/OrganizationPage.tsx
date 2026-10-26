import { useMemo, useState } from 'react'
import { useSession } from '@/core/auth/SessionProvider'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import { PageHeader } from '@/shared/components/PageHeader'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import type { BackupLink, BackupStatus, Cover, Department, DepartmentMember, LearnerAssignment } from './api'
import { DEPARTMENT_LABEL, POSITION_LABEL, STATUS_LABEL, T, describeError, useCopy } from './copy'
import { useAssignTeacher, useCovers, useLearners, useStructure, useTeacherAssignments } from './hooks'
import { CoverActions } from './CoverBanner'
import { HandOverDialog } from './HandOverDialog'
import { AssignSupervisorDialog, BackupActionDialog, CreateBackupDialog } from './OrgDialogs'
import type { BackupAction } from './hooks'
import './organization.css'
import { Link } from 'react-router-dom'
import { studentPath } from '@/features/profiles/api'

type Tab = 'children' | 'teachers' | 'structure'

/**
 * PD-8: the organization structure -- for the super admin (the whole
 * organization) and for managers (their own department). Which rows appear and
 * which changes succeed is decided by the server for this viewer; the page
 * shows controls, the API answers each request on its own.
 */
export function OrganizationPage() {
  const tx = useCopy()
  const { staff } = useSession()
  const structure = useStructure()
  const departments = structure.data?.departments ?? []
  const operations = departments.find((d) => d.kind === 'operations') ?? null
  // PD-35: the Teachers Manager and the super admin assign teachers to supervisors.
  const teachersDept = departments.find((d) => d.kind === 'teachers') ?? null
  const assignsTeachers = !!teachersDept && !!staff && (staff.role === 'super_admin' || teachersDept.manager?.id === staff.id)
  const [tab, setTab] = useState<Tab>('children')
  const shown: Tab =
    tab === 'children' ? (operations ? 'children' : assignsTeachers ? 'teachers' : 'structure')
    : tab === 'teachers' ? (assignsTeachers ? 'teachers' : 'structure')
    : 'structure'
  const tabs: Array<{ key: Tab; label: string }> = [
    ...(operations ? [{ key: 'children' as const, label: tx(T.tabChildren) }] : []),
    ...(assignsTeachers ? [{ key: 'teachers' as const, label: tx(T.tabTeachers) }] : []),
    { key: 'structure', label: tx(T.tabStructure) },
  ]

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader title={tx(T.title)} subtitle={tx(T.subtitle)} />
        <QueryBoundary isLoading={structure.isLoading} error={structure.error} onRetry={() => void structure.refetch()}>
          <div className="org-tabs" role="tablist" aria-label={tx(T.title)}>
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`org-tab-${t.key}`}
                aria-selected={shown === t.key}
                aria-controls={`org-panel-${t.key}`}
                className="org-tab"
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`org-panel-${shown}`} aria-labelledby={`org-tab-${shown}`}>
            {shown === 'children' && operations ? (
              <ChildrenTab operations={operations} />
            ) : shown === 'teachers' ? (
              <TeachersTab />
            ) : departments.length === 0 ? (
              <EmptyState title={tx(T.noOperations)} />
            ) : (
              departments.map((d) => <DepartmentCard key={d.id} department={d} />)
            )}
          </div>
        </QueryBoundary>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PD-35: teachers & their supervisors
// ---------------------------------------------------------------------------

function TeachersTab() {
  const tx = useCopy()
  const { number, locale } = useI18n()
  const data = useTeacherAssignments(true)
  const assign = useAssignTeacher()
  const view = data.data
  return (
    <QueryBoundary isLoading={data.isLoading} error={data.error} onRetry={() => void data.refetch()}>
      {view && (
        <>
          <p className={`banner ${view.unassigned > 0 ? 'banner--warn' : 'banner--info'}`} role="status">
            {view.unassigned > 0 ? tx(T.teachersUnassigned, { n: number(view.unassigned) }) : tx(T.teachersAllAssigned)}{' '}
            {tx(view.strictScope ? T.scopeOn : T.scopeOff)}
          </p>
          {assign.error && <p className="field__error" role="alert">{describeError(assign.error, locale)}</p>}
          {view.teachers.length === 0 ? (
            <EmptyState title={tx(T.noTeachers)} />
          ) : (
            <div className="table-wrap org-table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{tx(T.teacher)}</th>
                    <th scope="col">{tx(T.teacherSupervisor)}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.teachers.map((t) => (
                    <tr key={t.id}>
                      <td dir="auto">
                        {t.name}
                        {!t.isActive && <> <Badge tone="neutral">{tx(T.inactiveTeacher)}</Badge></>}
                      </td>
                      <td>
                        <select
                          className="select"
                          aria-label={tx(T.assignTitle, { name: t.name })}
                          value={t.supervisor?.id ?? ''}
                          disabled={assign.isPending}
                          onChange={(e) => assign.mutate({ teacherId: t.id, supervisorId: e.target.value || null })}
                        >
                          <option value="">{tx(T.noTeacherSupervisor)}</option>
                          {view.supervisors.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                        {!t.supervisor && t.isActive && <> <Badge tone="warn" dot>{tx(T.unassigned)}</Badge></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </QueryBoundary>
  )
}

// ---------------------------------------------------------------------------
// Children & supervisors
// ---------------------------------------------------------------------------

function ChildrenTab({ operations }: { operations: Department }) {
  const tx = useCopy()
  const { t, number } = useI18n()
  const learners = useLearners(true)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [editing, setEditing] = useState<LearnerAssignment | null>(null)
  const supervisors = operations.members.filter((m) => m.position === 'supervisor')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (learners.data?.learners ?? []).filter((l) => {
      if (filter === 'unassigned' && l.supervisor) return false
      if (filter !== 'all' && filter !== 'unassigned' && l.supervisor?.id !== filter) return false
      if (!q) return true
      return l.name.toLowerCase().includes(q) || l.family.displayName.toLowerCase().includes(q)
    })
  }, [learners.data, query, filter])

  return (
    <QueryBoundary isLoading={learners.isLoading} error={learners.error} onRetry={() => void learners.refetch()}>
      <div className="toolbar">
        <SearchField value={query} onChange={setQuery} label={tx(T.search)} clearLabel={t('common.cancel')} />
        <div className="org-filter">
          <label className="field__label" htmlFor="org-filter">{tx(T.filter)}</label>
          <select id="org-filter" className="select" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">{tx(T.filterAll)}</option>
            <option value="unassigned">{tx(T.filterUnassigned)}</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <span className="toolbar__count">{tx(T.count, { n: number(rows.length) })}</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={tx(T.noChildren)} />
      ) : (
        <div className="table-wrap org-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{tx(T.child)}</th>
                <th scope="col">{tx(T.family)}</th>
                <th scope="col">{tx(T.teacher)}</th>
                <th scope="col">{tx(T.supervisor)}</th>
                <th scope="col"><span className="sr-only">{tx(T.assign)}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.learnerId}>
                  <td dir="auto">
                    {/* PD-17: the child's Student Profile. */}
                    <Link to={studentPath(l.learnerId)}>{l.name}</Link>
                  </td>
                  <td dir="auto">{l.family.displayName}</td>
                  <td dir="auto">{l.teacher?.name ?? <span className="org-muted">{tx(T.noTeacher)}</span>}</td>
                  <td dir="auto">{l.supervisor?.name ?? <Badge tone="warn" dot>{tx(T.unassigned)}</Badge>}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setEditing(l)}
                      aria-label={`${l.supervisor ? tx(T.change) : tx(T.assign)} — ${l.name}`}
                    >
                      {l.supervisor ? tx(T.change) : tx(T.assign)}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <AssignSupervisorDialog learner={editing} supervisors={supervisors} onClose={() => setEditing(null)} />
      )}
    </QueryBoundary>
  )
}

// ---------------------------------------------------------------------------
// Departments & backups
// ---------------------------------------------------------------------------

const STATUS_TONE: Record<BackupStatus, Tone> = {
  active: 'ok',
  dormant: 'neutral',
  expired: 'warn',
  deactivated: 'outline',
  ended: 'outline',
}

function DepartmentCard({ department }: { department: Department }) {
  const tx = useCopy()
  const { staff } = useSession()
  const [creating, setCreating] = useState(false)
  const [acting, setActing] = useState<{ link: BackupLink; action: BackupAction } | null>(null)
  const [handingOver, setHandingOver] = useState<DepartmentMember | null>(null)
  const canManage = staff?.role === 'super_admin' || staff?.role === 'manager'
  // PD-33: who is away and who is covering, for the Operations team.
  const covers = useCovers(department.kind === 'operations').data?.covers ?? []
  const headingId = `org-dept-${department.id}`

  return (
    <section className="card panel org-dept" aria-labelledby={headingId}>
      <div className="org-dept__head">
        <h2 id={headingId} className="org-dept__title">{tx(DEPARTMENT_LABEL[department.kind])}</h2>
        <span className="org-muted">
          {tx(T.manager)}: {department.manager?.name ?? tx(T.noManager)}
        </span>
      </div>

      <h3>{tx(T.members)}</h3>
      {department.members.length === 0 ? (
        <p className="org-muted">{tx(T.noMembers)}</p>
      ) : (
        <div className="table-wrap org-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{tx(T.personName)}</th>
                <th scope="col">{tx(T.position)}</th>
                <th scope="col">{tx(T.childrenCount)}</th>
                {department.kind === 'operations' && <th scope="col">{tx(T.handOver)}</th>}
              </tr>
            </thead>
            <tbody>
              {department.members.map((m: DepartmentMember) => (
                <tr key={m.id}>
                  <td dir="auto">{m.name}</td>
                  <td>{tx(POSITION_LABEL[m.position])}</td>
                  <td>{m.learnerCount}</td>
                  {department.kind === 'operations' && (
                    <td>
                      <MemberCover member={m} covers={covers} canManage={canManage} onHandOver={() => setHandingOver(m)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {department.kind === 'operations' && (
        <>
          <div className="org-dept__head">
            <h3>{tx(T.backups)}</h3>
            {canManage && (
              <button type="button" className="btn btn--sm" onClick={() => setCreating(true)}>
                {tx(T.addBackup)}
              </button>
            )}
          </div>
          <p className="field__hint">{tx(T.backupsHint)}</p>
          {department.backups.length === 0 ? (
            <p className="org-muted">{tx(T.noBackups)}</p>
          ) : (
            <ul className="org-backups">
              {department.backups.map((link) => (
                <BackupRow key={link.id} link={link} canManage={canManage} onAct={(action) => setActing({ link, action })} />
              ))}
            </ul>
          )}
        </>
      )}

      {creating && <CreateBackupDialog members={department.members} onClose={() => setCreating(false)} />}
      {acting && <BackupActionDialog link={acting.link} action={acting.action} onClose={() => setActing(null)} />}
      {handingOver && (
        <HandOverDialog supervisor={{ id: handingOver.id, name: handingOver.name }} onClose={() => setHandingOver(null)} />
      )}
    </section>
  )
}

/**
 * PD-33 in the team table: a supervisor away ("Away until 3 Nov · Amira
 * covering", Extend / End cover now), a backup covering ("Covering Noura until
 * 3 Nov"), or -- for a primary supervisor a manager runs -- "Hand over to backup".
 */
function MemberCover({
  member,
  covers,
  canManage,
  onHandOver,
}: {
  member: DepartmentMember
  covers: Cover[]
  canManage: boolean
  onHandOver: () => void
}) {
  const tx = useCopy()
  const { date } = useI18n()
  const away = covers.find((c) => c.supervisor.id === member.id && c.status !== 'ended')
  const covering = covers.filter((c) => c.backup.id === member.id && c.status === 'active')
  if (away) {
    return (
      <span className="cover-cell">
        <Badge tone="warn" dot>
          {away.status === 'scheduled' ? tx(T.scheduled, { backup: away.backup.name, date: date(away.startsAt) }) : tx(T.awayUntil, { date: date(away.endsAt) })}
        </Badge>
        {away.status === 'active' && <Badge tone="coverage">{tx(T.coveredBy, { backup: away.backup.name })}</Badge>}
        <CoverActions cover={away} />
      </span>
    )
  }
  if (covering.length > 0) {
    return (
      <span className="cover-cell">
        {covering.map((c) => (
          <Badge key={c.id} tone="coverage" dot>
            {tx(T.coveringFor, { name: c.supervisor.name, date: date(c.endsAt) })}
          </Badge>
        ))}
      </span>
    )
  }
  if (canManage && member.position === 'supervisor' && member.isActive) {
    return (
      <button type="button" className="btn btn--sm" onClick={onHandOver} aria-label={`${tx(T.handOver)} — ${member.name}`}>
        {tx(T.handOver)}
      </button>
    )
  }
  return null
}

function BackupRow({ link, canManage, onAct }: { link: BackupLink; canManage: boolean; onAct: (a: BackupAction) => void }) {
  const tx = useCopy()
  const { date } = useI18n()
  const names = { backup: link.backup?.name ?? '', primary: link.primary?.name ?? '' }
  return (
    <li className="org-backup">
      <span dir="auto">
        {tx(T.covers, names)}{' '}
        <Badge tone={STATUS_TONE[link.status]} dot>{tx(STATUS_LABEL[link.status])}</Badge>
        {link.status === 'active' && link.activeUntil && (
          <span className="org-muted"> {tx(T.until, { date: date(link.activeUntil) })}</span>
        )}
      </span>
      {canManage && link.status !== 'ended' && (
        <span className="org-backup__actions">
          {link.status === 'active' ? (
            <button type="button" className="btn btn--sm" onClick={() => onAct('deactivate')} aria-label={`${tx(T.deactivate)} — ${tx(T.covers, names)}`}>
              {tx(T.deactivate)}
            </button>
          ) : (
            <button type="button" className="btn btn--primary btn--sm" onClick={() => onAct('activate')} aria-label={`${tx(T.activate)} — ${tx(T.covers, names)}`}>
              {tx(T.activate)}
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onAct('end')} aria-label={`${tx(T.end)} — ${tx(T.covers, names)}`}>
            {tx(T.end)}
          </button>
        </span>
      )}
    </li>
  )
}
