import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useSession } from '@/core/auth/SessionProvider'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge, type Tone } from '@/shared/components/Badge'
import type { MenuItem } from '@/shared/components/Menu'
import { PageHeader } from '@/shared/components/PageHeader'
import { RowActions } from '@/shared/components/RowActions'
import { SearchField } from '@/shared/components/SearchField'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { PLURAL, usePlural } from '@/features/admin/copy'
import { countWords } from '@/features/instalments/copy'
import { CHILDREN_COUNT } from '@/features/profiles/copy'
import { studentPath } from '@/features/profiles/api'
import { SupervisorColors } from '@/features/schedule/SupervisorColors'
import { useDay } from '@/features/devices/when'
import { fill } from '@/features/profiles/RecordHead'
import type { BackupLink, BackupStatus, Cover, Department, DepartmentMember, LearnerAssignment, TeacherAssignment } from './api'
import { CHILDREN_WAITING, DEPARTMENT_LABEL, POSITION_LABEL, STATUS_LABEL, T, TEACHERS_WAITING, describeError, useCopy } from './copy'
import { useAssignTeacher, useCovers, useEndCover, useExtendCover, useLearners, useStructure, useTeacherAssignments } from './hooks'
import type { BackupAction } from './hooks'
import { HandOverDialog } from './HandOverDialog'
import { AssignSupervisorDialog, BackupActionDialog, CreateBackupDialog } from './OrgDialogs'
import './organization.css'

type Tab = 'children' | 'teachers' | 'structure'
const TABS: readonly Tab[] = ['children', 'teachers', 'structure']

/** A staff member's profile: every staff person on this page leads to it. */
const profilePath = (staffId: string) => `/profile/${encodeURIComponent(staffId)}`

/**
 * PD-8: the organization structure -- for the super admin (the whole
 * organization) and for managers (their own department). Which rows appear and
 * which changes succeed is decided by the server for this viewer; the page
 * shows controls, the API answers each request on its own.
 *
 * The structure is set out as groups, not flat tables. The masthead holds the
 * three views as tabs, each saying how many still wait for a supervisor.
 * Children are listed under the supervisor who has them (those with none
 * first); teachers under theirs; and each department is a sheet of its team
 * and its backup links. Every staff person's name opens their profile.
 */
export function OrganizationPage() {
  const tx = useCopy()
  const { number, locale } = useI18n()
  const { staff } = useSession()
  const structure = useStructure()
  const departments = structure.data?.departments ?? []
  const operations = departments.find((d) => d.kind === 'operations') ?? null
  // PD-35: the Teachers Manager and the super admin assign teachers to supervisors.
  const teachersDept = departments.find((d) => d.kind === 'teachers') ?? null
  const assignsTeachers = !!teachersDept && !!staff && (staff.role === 'super_admin' || teachersDept.manager?.id === staff.id)
  // ?tab=teachers: Teacher Files' "Assign supervisor" shortcut (PD-43 §3.7) lands on that tab.
  // PD-44: the tab lives in the URL, read on every render, so a Dashboard tile
  // (?tab=children&filter=unassigned, ?tab=teachers, ?tab=structure) moves it too.
  const [params, setParams] = useSearchParams()
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'children'
  const setTab = (next: Tab) =>
    setParams((current) => {
      const p = new URLSearchParams(current)
      p.set('tab', next)
      p.delete('filter')
      return p
    }, { replace: true })
  const shown: Tab =
    tab === 'children' ? (operations ? 'children' : assignsTeachers ? 'teachers' : 'structure')
    : tab === 'teachers' ? (assignsTeachers ? 'teachers' : 'structure')
    : 'structure'
  // What still waits for a supervisor is said on the tab that settles it. Each list is the one its tab shows.
  const learners = useLearners(!!operations)
  const teachers = useTeacherAssignments(assignsTeachers)
  const waiting = {
    children: learners.data ? learners.data.learners.filter((l) => !l.supervisor).length : 0,
    teachers: teachers.data?.unassigned ?? 0,
    structure: 0,
  }
  const tabs: Array<{ key: Tab; label: string; waiting: string }> = [
    ...(operations ? [{ key: 'children' as const, label: tx(T.tabChildren), waiting: countWords(waiting.children, CHILDREN_WAITING, locale) }] : []),
    ...(assignsTeachers ? [{ key: 'teachers' as const, label: tx(T.tabTeachers), waiting: countWords(waiting.teachers, TEACHERS_WAITING, locale) }] : []),
    { key: 'structure', label: tx(T.tabStructure), waiting: '' },
  ]

  return (
    <div className="page dir org-page">
      <div className="page__inner">
        <PageHeader
          title={tx(T.title)}
          tabs={
            structure.data && (
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
                    title={waiting[t.key] > 0 ? t.waiting : undefined}
                    onClick={() => setTab(t.key)}
                  >
                    {t.label}
                    {waiting[t.key] > 0 && (
                      <span className="count count--urgent" aria-hidden="true">
                        {number(waiting[t.key])}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )
          }
        />
        <QueryBoundary isLoading={structure.isLoading} error={structure.error} onRetry={() => void structure.refetch()}>
          <div role="tabpanel" id={`org-panel-${shown}`} aria-labelledby={`org-tab-${shown}`} className="org-panel">
            {shown === 'children' && operations ? (
              <ChildrenTab operations={operations} />
            ) : shown === 'teachers' ? (
              <TeachersTab />
            ) : departments.length === 0 ? (
              <EmptyState title={tx(T.noOperations)} />
            ) : (
              departments.map((d) => <DepartmentSheet key={d.id} department={d} />)
            )}
          </div>
        </QueryBoundary>
      </div>
    </div>
  )
}

/** The head of a group of rows: who the group belongs to (or the words "no supervisor", with the amber dot of a group nobody holds), how many, and what applies to them. */
function GroupHead({ columns, who, count, children }: { columns: number; who: ReactNode; count: number; children?: ReactNode }) {
  const { number } = useI18n()
  return (
    <tr className="dir-group__head">
      <th colSpan={columns} scope="rowgroup">
        <span className="org-group">
          <span className="dir-group__title">
            {who}
            <span className="count count--quiet">{number(count)}</span>
          </span>
          {children}
        </span>
      </th>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// PD-35: teachers & their supervisors
// ---------------------------------------------------------------------------

interface TeacherGroup {
  key: string
  kind: 'unassigned' | 'supervisor' | 'inactive'
  supervisor: { id: string; name: string } | null
  rows: TeacherAssignment[]
}

/** A supervisor who was deactivated or left the department supervises no one. */
const liveSupervisor = (t: TeacherAssignment) => (t.supervisor && t.supervisor.isActive !== false ? t.supervisor : null)

function TeachersTab() {
  const tx = useCopy()
  const plural = usePlural()
  const { locale } = useI18n()
  const data = useTeacherAssignments(true)
  const assign = useAssignTeacher()
  const view = data.data

  // Under each supervisor, with whoever has none first; a teacher who no longer teaches and has none comes last.
  const groups = useMemo<TeacherGroup[]>(() => {
    if (!view) return []
    const unassigned: TeacherAssignment[] = []
    const inactive: TeacherAssignment[] = []
    const bySupervisor = new Map<string, TeacherGroup>(
      view.supervisors.map((s) => [s.id, { key: s.id, kind: 'supervisor' as const, supervisor: s, rows: [] }]),
    )
    for (const t of view.teachers) {
      const live = liveSupervisor(t)
      if (!live) {
        ;(t.isActive ? unassigned : inactive).push(t)
        continue
      }
      const group = bySupervisor.get(live.id) ?? { key: live.id, kind: 'supervisor' as const, supervisor: live, rows: [] }
      group.rows.push(t)
      bySupervisor.set(live.id, group)
    }
    return [
      ...(unassigned.length > 0 ? [{ key: '__none', kind: 'unassigned' as const, supervisor: null, rows: unassigned }] : []),
      ...bySupervisor.values(),
      ...(inactive.length > 0 ? [{ key: '__inactive', kind: 'inactive' as const, supervisor: null, rows: inactive }] : []),
    ]
  }, [view])

  return (
    <QueryBoundary isLoading={data.isLoading} error={data.error} onRetry={() => void data.refetch()}>
      {view && (
        <section className="sheet dir-sheet org-sheet" aria-label={tx(T.tabTeachers)}>
          <div className="sheet-bar org-bar">
            <p className={view.unassigned > 0 ? 'org-rule org-rule--waiting' : 'org-rule'} role="status">
              <strong>{view.unassigned > 0 ? `${countWords(view.unassigned, TEACHERS_WAITING, locale)}.` : tx(T.teachersAllAssigned)}</strong>{' '}
              {tx(view.strictScope ? T.scopeOn : T.scopeOff)}
            </p>
            <span className="dir-count">{plural(PLURAL.teachers, view.teachers.length)}</span>
          </div>
          {assign.error && <p className="field__error org-error" role="alert">{describeError(assign.error, locale)}</p>}
          {view.teachers.length === 0 ? (
            <EmptyState title={tx(T.noTeachers)} />
          ) : (
            <table className="dir-table dir-table--grouped org-table org-table--teachers">
              <thead>
                <tr>
                  <th scope="col">{tx(T.teacher)}</th>
                  <th scope="col">{tx(T.teacherSupervisor)}</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.key} className={g.kind === 'unassigned' ? 'dir-group dir-group--unplaced' : 'dir-group'}>
                  <GroupHead
                    columns={2}
                    count={g.rows.length}
                    who={
                      g.supervisor ? (
                        <>
                          <span className="dir-group__label">{tx(T.supervisor)}</span>
                          <Link to={profilePath(g.supervisor.id)} className="org-person">
                            <bdi>{g.supervisor.name}</bdi>
                          </Link>
                        </>
                      ) : g.kind === 'unassigned' ? (
                        <span>{tx(T.unassigned)}</span>
                      ) : (
                        <span className="dir-group__label">{tx(T.inactiveTeacher)}</span>
                      )
                    }
                  />
                  {g.rows.map((t) => {
                    const live = liveSupervisor(t)
                    return (
                      <tr key={t.id} className="dir-row">
                        <td className="dir-cell-who">
                          <span className="dir-who">
                            <Avatar name={t.name} seed={t.id} />
                            <span className="dir-who__text">
                              <span className="org-name">
                                <strong className="dir-name">
                                  <bdi>{t.name}</bdi>
                                </strong>
                                {!t.isActive && <Badge tone="neutral">{tx(T.inactiveTeacher)}</Badge>}
                              </span>
                              {t.supervisor && !live && (
                                <span className="org-sub">{tx(T.formerSupervisor, { name: t.supervisor.name })}</span>
                              )}
                            </span>
                          </span>
                        </td>
                        <td className="org-cell-pick">
                          <SearchableSelect
                            clearable={false}
                            className="select"
                            aria-label={tx(T.assignTitle, { name: t.name })}
                            value={live?.id ?? ''}
                            disabled={assign.isPending}
                            onValueChange={(v) => assign.mutate({ teacherId: t.id, supervisorId: v || null })}
                          >
                            <option value="">{tx(T.noTeacherSupervisor)}</option>
                            {view.supervisors.map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </SearchableSelect>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              ))}
            </table>
          )}
        </section>
      )}
    </QueryBoundary>
  )
}

// ---------------------------------------------------------------------------
// Children & supervisors
// ---------------------------------------------------------------------------

interface ChildGroup {
  key: string
  supervisor: { id: string; name: string } | null
  /** The supervisor's place in the department, when they hold one: what a hand-over needs. */
  member: DepartmentMember | null
  rows: LearnerAssignment[]
}

function ChildrenTab({ operations }: { operations: Department }) {
  const tx = useCopy()
  const { t, locale } = useI18n()
  const { staff } = useSession()
  const learners = useLearners(true)
  // PD-33: who is away and who covers, said on the supervisor's group.
  const covers = useCovers(true).data?.covers ?? []
  const canManage = staff?.role === 'super_admin' || staff?.role === 'manager'
  const [query, setQuery] = useState('')
  // PD-44: ?filter=unassigned (or a supervisor's id) -- the Dashboard's children tile opens the list it counted.
  const [params, setParams] = useSearchParams()
  const filter = params.get('filter') || 'all'
  const setFilter = (next: string) =>
    setParams((current) => {
      const p = new URLSearchParams(current)
      if (next === 'all') p.delete('filter')
      else p.set('filter', next)
      return p
    }, { replace: true })
  const [editing, setEditing] = useState<LearnerAssignment | null>(null)
  const [handingOver, setHandingOver] = useState<DepartmentMember | null>(null)
  const supervisors = useMemo(() => operations.members.filter((m) => m.position === 'supervisor'), [operations.members])

  const unplaced = (learners.data?.learners ?? []).filter((l) => !l.supervisor).length
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (learners.data?.learners ?? []).filter((l) => {
      if (filter === 'unassigned' && l.supervisor) return false
      if (filter !== 'all' && filter !== 'unassigned' && l.supervisor?.id !== filter) return false
      if (!q) return true
      return l.name.toLowerCase().includes(q) || l.family.displayName.toLowerCase().includes(q)
    })
  }, [learners.data, query, filter])

  // A group per supervisor, by name; the children nobody supervises come first.
  const groups = useMemo<ChildGroup[]>(() => {
    const none: LearnerAssignment[] = []
    const by = new Map<string, ChildGroup>()
    for (const l of rows) {
      if (!l.supervisor) {
        none.push(l)
        continue
      }
      const group = by.get(l.supervisor.id) ?? {
        key: l.supervisor.id,
        supervisor: l.supervisor,
        member: operations.members.find((m) => m.id === l.supervisor!.id) ?? null,
        rows: [],
      }
      group.rows.push(l)
      by.set(l.supervisor.id, group)
    }
    // With nothing narrowing the list, a supervisor who has no children yet is shown too, with a count of none.
    if (filter === 'all' && query.trim() === '') {
      for (const m of supervisors) if (!by.has(m.id)) by.set(m.id, { key: m.id, supervisor: m, member: m, rows: [] })
    }
    const ordered = [...by.values()].sort((a, b) => (a.supervisor?.name ?? '').localeCompare(b.supervisor?.name ?? '', locale))
    return [...(none.length > 0 ? [{ key: '__none', supervisor: null, member: null, rows: none }] : []), ...ordered]
  }, [rows, operations.members, supervisors, filter, query, locale])

  return (
    <QueryBoundary isLoading={learners.isLoading} error={learners.error} onRetry={() => void learners.refetch()}>
      <section className="sheet dir-sheet org-sheet" aria-label={tx(T.tabChildren)}>
        <div className="sheet-bar org-bar">
          {/* The answer first: how many children nobody supervises, or that every child has someone. */}
          {learners.data && (
            <p className={unplaced > 0 ? 'org-rule org-rule--waiting org-rule--line' : 'org-rule org-rule--line'} role="status">
              <strong>{unplaced > 0 ? `${countWords(unplaced, CHILDREN_WAITING, locale)}.` : tx(T.allChildrenAssigned)}</strong>
            </p>
          )}
          <SearchField value={query} onChange={setQuery} label={tx(T.search)} clearLabel={t('common.cancel')} />
          <div className="org-filter">
            <label className="field__label" htmlFor="org-filter">{tx(T.filter)}</label>
            <SearchableSelect id="org-filter" className="select" value={filter} onValueChange={(v) => setFilter(v)}>
              <option value="all">{tx(T.filterAll)}</option>
              <option value="unassigned">{tx(T.filterUnassigned)}</option>
              {supervisors.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </SearchableSelect>
          </div>
          <span className="dir-count">{countWords(rows.length, CHILDREN_COUNT, locale)}</span>
        </div>
        {rows.length === 0 ? (
          // Asked for the children with no supervisor and there are none: that is the answer, said as one.
          <EmptyState title={tx(filter === 'unassigned' && !query.trim() ? T.allChildrenAssigned : T.noChildren)} />
        ) : (
          <table className="dir-table dir-table--grouped org-table">
            <thead>
              <tr>
                <th scope="col">{tx(T.child)}</th>
                <th scope="col">{tx(T.teacher)}</th>
                <th scope="col" className="cell-actions">
                  <span className="sr-only">{tx(T.assign)}</span>
                </th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.key} className={g.supervisor ? 'dir-group' : 'dir-group dir-group--unplaced'}>
                <GroupHead
                  columns={3}
                  count={g.rows.length}
                  who={
                    g.supervisor ? (
                      <>
                        <span className="dir-group__label">{tx(T.supervisor)}</span>
                        <Link to={profilePath(g.supervisor.id)} className="org-person">
                          <bdi>{g.supervisor.name}</bdi>
                        </Link>
                      </>
                    ) : (
                      <span>{tx(T.unassigned)}</span>
                    )
                  }
                >
                  {g.member && (
                    <span className="org-group__cover">
                      <CoverTags member={g.member} covers={covers} />
                      <CoverControl member={g.member} covers={covers} canManage={canManage} onHandOver={() => setHandingOver(g.member)} menuOnly />
                    </span>
                  )}
                </GroupHead>
                {g.rows.map((l) => (
                  <tr key={l.learnerId} className="dir-row">
                    <td className="dir-cell-who">
                      <span className="dir-who">
                        <Avatar name={l.name} seed={l.learnerId} />
                        <span className="dir-who__text">
                          {/* PD-17: the child's Student Profile. */}
                          <Link to={studentPath(l.learnerId)} className="dir-name">
                            <bdi>{l.name}</bdi>
                          </Link>
                          <span className="org-sub">
                            <bdi>{l.family.displayName}</bdi>
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className={l.teacher ? 'dir-cell-quiet' : 'dir-cell-quiet dir-cell-quiet--none'} data-label={tx(T.teacher)}>
                      {l.teacher ? <bdi>{l.teacher.name}</bdi> : <span className="dir-none">{tx(T.noTeacher)}</span>}
                    </td>
                    <td className="cell-actions">
                      <RowActions
                        label={tx(T.more, { name: l.name })}
                        primary={
                          <button
                            type="button"
                            className="btn btn--sm"
                            onClick={() => setEditing(l)}
                            aria-label={`${l.supervisor ? tx(T.change) : tx(T.assign)} — ${l.name}`}
                          >
                            {l.supervisor ? tx(T.change) : tx(T.assign)}
                          </button>
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        )}
      </section>
      {editing && (
        <AssignSupervisorDialog learner={editing} supervisors={supervisors} onClose={() => setEditing(null)} />
      )}
      {handingOver && (
        <HandOverDialog supervisor={{ id: handingOver.id, name: handingOver.name }} onClose={() => setHandingOver(null)} />
      )}
    </QueryBoundary>
  )
}

// ---------------------------------------------------------------------------
// Departments & backups
// ---------------------------------------------------------------------------

/** A link in force is where things stand (a teal tag); one that ran out waits on someone (amber); the rest is a quiet word. */
const STATUS_TONE: Record<BackupStatus, Tone> = {
  active: 'info',
  dormant: 'neutral',
  expired: 'warn',
  deactivated: 'outline',
  ended: 'outline',
}

function DepartmentSheet({ department }: { department: Department }) {
  const tx = useCopy()
  const plural = usePlural()
  const { number } = useI18n()
  const { staff } = useSession()
  const [creating, setCreating] = useState(false)
  const [acting, setActing] = useState<{ link: BackupLink; action: BackupAction } | null>(null)
  const [handingOver, setHandingOver] = useState<DepartmentMember | null>(null)
  const canManage = staff?.role === 'super_admin' || staff?.role === 'manager'
  const operations = department.kind === 'operations'
  // PD-33: who is away and who is covering, for the Operations team.
  const covers = useCovers(operations).data?.covers ?? []
  const headingId = `org-dept-${department.id}`
  const date = useDay()
  // The supervisors first (they hold the children), their backups after; each group keeps the server's order.
  const team = [...department.members].sort((a, b) => Number(a.position !== 'supervisor') - Number(b.position !== 'supervisor'))
  // The backup links that still stand (dormant, active or run out); those ended or switched off are history.
  const inForce = department.backups.filter((l) => l.status !== 'ended' && l.status !== 'deactivated')

  return (
    <section className="sheet rec-sheet org-dept" aria-labelledby={headingId}>
      <div className="sheet__head">
        <div className="rec-sheet__title">
          <h2 id={headingId} className="sheet__title">{tx(DEPARTMENT_LABEL[department.kind])}</h2>
          <span className="sheet__count">{plural(PLURAL.people, department.members.length)}</span>
        </div>
        <span className="org-dept__manager">
          {tx(T.manager)}:{' '}
          {department.manager ? (
            <Link to={profilePath(department.manager.id)} className="org-person">
              <bdi>{department.manager.name}</bdi>
            </Link>
          ) : (
            tx(T.noManager)
          )}
        </span>
      </div>

      {department.members.length === 0 ? (
        <p className="rec-empty">{tx(T.noMembers)}</p>
      ) : (
        <table className="dir-table org-table org-table--team" aria-label={tx(T.members)}>
          <thead>
            <tr>
              <th scope="col">{tx(T.personName)}</th>
              <th scope="col" className="org-cell-num">{tx(T.childrenCount)}</th>
              {operations && (
                <th scope="col">
                  <span className="sr-only">{tx(T.handOver)}</span>
                </th>
              )}
              {operations && (
                <th scope="col" className="cell-actions">
                  <span className="sr-only">{tx(T.handOver)}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {team.map((m: DepartmentMember) => {
              // Who covers whom, said on the people it concerns: a supervisor's backup, a backup's supervisors.
              const backedBy = inForce.filter((l) => l.primary?.id === m.id && l.backup)
              const backs = inForce.filter((l) => l.backup?.id === m.id && l.primary)
              return (
              <tr key={m.id} className="dir-row">
                <td className="dir-cell-who">
                  <span className="dir-who">
                    <Avatar name={m.name} seed={m.id} />
                    <span className="dir-who__text">
                      <Link to={profilePath(m.id)} className="dir-name">
                        <bdi>{m.name}</bdi>
                      </Link>
                      <span className="org-sub org-sub--facts">
                        <span>{tx(POSITION_LABEL[m.position])}</span>
                        {backedBy.map((l) => (
                          <span key={l.id}>
                            {fill(tx(T.backupIs), { name: <bdi>{l.backup!.name}</bdi> })} ({tx(STATUS_LABEL[l.status])}
                            {l.status === 'active' && l.activeUntil ? ` ${tx(T.until, { date: date(l.activeUntil) })}` : ''})
                          </span>
                        ))}
                        {backs.length > 0 && (
                          <span>{fill(tx(T.backupFor), { names: <bdi>{backs.map((l) => l.primary!.name).join(tx(T.listComma))}</bdi> })}</span>
                        )}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="org-cell-num" data-label={tx(T.childrenCount)}>
                  <span className={m.learnerCount > 0 ? 'org-num' : 'org-num org-num--none'}>{number(m.learnerCount)}</span>
                </td>
                {operations && (
                  <td className="org-cell-cover">
                    <CoverTags member={m} covers={covers} />
                  </td>
                )}
                {operations && (
                  <td className="cell-actions">
                    <CoverControl member={m} covers={covers} canManage={canManage} onHandOver={() => setHandingOver(m)} />
                  </td>
                )}
              </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {operations && (
        <div className="org-part">
          <div className="org-part__head">
            <h3 className="org-part__title">{tx(T.backups)}</h3>
            {canManage && (
              <button type="button" className="btn btn--sm" onClick={() => setCreating(true)}>
                {tx(T.addBackup)}
              </button>
            )}
          </div>
          <p className="org-part__rule">{tx(T.backupsHint)}</p>
          {department.backups.length === 0 ? (
            <p className="org-part__none">{tx(T.noBackups)}</p>
          ) : (
            <ul className="org-backups">
              {department.backups.map((link) => (
                <BackupRow key={link.id} link={link} canManage={canManage} onAct={(action) => setActing({ link, action })} />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* PD-38: each supervisor's schedule color. */}
      {operations && (
        <div className="org-part org-part--colors">
          <SupervisorColors />
        </div>
      )}

      {creating && <CreateBackupDialog members={department.members} onClose={() => setCreating(false)} />}
      {acting && <BackupActionDialog link={acting.link} action={acting.action} onClose={() => setActing(null)} />}
      {handingOver && (
        <HandOverDialog supervisor={{ id: handingOver.id, name: handingOver.name }} onClose={() => setHandingOver(null)} />
      )}
    </section>
  )
}

/** The cover a supervisor is away under, and the covers a backup holds now. */
function coverOf(member: DepartmentMember, covers: Cover[]) {
  return {
    away: covers.find((c) => c.supervisor.id === member.id && c.status !== 'ended') ?? null,
    covering: covers.filter((c) => c.backup.id === member.id && c.status === 'active'),
  }
}

/**
 * PD-33, said as tags: a supervisor away ("Away until 3 Nov", "Amira
 * covering"), a hand-over that has not started yet, or a backup covering
 * ("Covering Noura until 3 Nov"). Nothing when neither applies.
 */
function CoverTags({ member, covers }: { member: DepartmentMember; covers: Cover[] }) {
  const tx = useCopy()
  const date = useDay()
  const { away, covering } = coverOf(member, covers)
  if (away) {
    return (
      <span className="cover-cell">
        <Badge tone="warn">
          {away.status === 'scheduled' ? tx(T.scheduled, { backup: away.backup.name, date: date(away.startsAt) }) : tx(T.awayUntil, { date: date(away.endsAt) })}
        </Badge>
        {away.status === 'active' && <Badge tone="coverage">{tx(T.coveredBy, { backup: away.backup.name })}</Badge>}
      </span>
    )
  }
  if (covering.length === 0) return null
  return (
    <span className="cover-cell">
      {covering.map((c) => (
        <Badge key={c.id} tone="coverage">
          {tx(T.coveringFor, { name: c.supervisor.name, date: date(c.endsAt) })}
        </Badge>
      ))}
    </span>
  )
}

/**
 * PD-33, as a row's actions: Extend (one tap: the same window again) and End
 * cover now while a supervisor is away, as the server says this viewer may
 * (`canExtend`, `canEnd`); "Hand over to backup" for a primary supervisor a
 * manager runs who is neither away nor covering. One is stated, the other
 * waits behind "more"; `menuOnly` (a group's head) keeps them all there.
 */
function CoverControl({
  member,
  covers,
  canManage,
  onHandOver,
  menuOnly = false,
}: {
  member: DepartmentMember
  covers: Cover[]
  canManage: boolean
  onHandOver: () => void
  menuOnly?: boolean
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const extend = useExtendCover()
  const end = useEndCover()
  const error = extend.error ?? end.error
  const { away, covering } = coverOf(member, covers)
  const busy = extend.isPending || end.isPending
  const actions: Array<MenuItem & { name?: string }> = away
    ? [
        ...(away.canExtend ? [{ key: 'extend', label: tx(T.extend), icon: 'timer' as const, onSelect: () => { if (!busy) extend.mutate(away.id) } }] : []),
        ...(away.canEnd ? [{ key: 'end', label: tx(T.endNow), icon: 'undo' as const, onSelect: () => { if (!busy) end.mutate(away.id) } }] : []),
      ]
    : covering.length === 0 && canManage && member.position === 'supervisor' && member.isActive
      ? [{ key: 'handover', label: tx(T.handOver), icon: 'swap' as const, name: `${tx(T.handOver)} — ${member.name}`, onSelect: onHandOver }]
      : []
  const [first, ...rest] = actions
  if (!first && !error) return null
  return (
    <span className="org-control">
      {first && (
        <RowActions
          label={tx(T.more, { name: member.name })}
          primary={
            menuOnly ? undefined : (
              <button type="button" className="btn btn--sm" disabled={busy} onClick={first.onSelect} aria-label={first.name}>
                {first.label}
              </button>
            )
          }
          more={menuOnly ? actions : rest}
        />
      )}
      {error ? (
        <span className="field__error" role="alert">
          {describeError(error, locale)}
        </span>
      ) : null}
    </span>
  )
}

/** One backup link: who covers whom, where it stands, and its actions: activating or stopping it stated, ending it behind "more". */
function BackupRow({ link, canManage, onAct }: { link: BackupLink; canManage: boolean; onAct: (a: BackupAction) => void }) {
  const tx = useCopy()
  const date = useDay()
  const names = { backup: link.backup?.name ?? '', primary: link.primary?.name ?? '' }
  const sentence = tx(T.covers, names)
  return (
    <li className={link.status === 'ended' || link.status === 'deactivated' ? 'org-backup org-backup--over' : 'org-backup'}>
      <span className="org-backup__what">
        <span className="org-backup__who">{sentence}</span>
        <Badge tone={STATUS_TONE[link.status]}>{tx(STATUS_LABEL[link.status])}</Badge>
        {link.status === 'active' && link.activeUntil && <span className="org-sub">{tx(T.until, { date: date(link.activeUntil) })}</span>}
      </span>
      {canManage && link.status !== 'ended' && (
        <RowActions
          label={tx(T.more, { name: sentence })}
          primary={
            link.status === 'active' ? (
              <button type="button" className="btn btn--sm" onClick={() => onAct('deactivate')} aria-label={`${tx(T.deactivate)} — ${sentence}`}>
                {tx(T.deactivate)}
              </button>
            ) : (
              <button type="button" className="btn btn--sm" onClick={() => onAct('activate')} aria-label={`${tx(T.activate)} — ${sentence}`}>
                {tx(T.activate)}
              </button>
            )
          }
          more={[{ key: 'end', label: tx(T.end), icon: 'xCircle', danger: true, onSelect: () => onAct('end') }]}
        />
      )}
    </li>
  )
}
