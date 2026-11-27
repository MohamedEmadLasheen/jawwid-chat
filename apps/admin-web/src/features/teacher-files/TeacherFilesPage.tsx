import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { FilterChips } from '@/shared/components/FilterChips'
import type { MenuItem } from '@/shared/components/Menu'
import { PageHeader } from '@/shared/components/PageHeader'
import { useTeacherAssignments } from '@/features/organization/hooks'
import { RowActions } from '@/shared/components/RowActions'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { AwayBadge } from './Complaint'
import { T, useCopy } from './copy'
import { Refusal, isTeacherFileRefusal } from './Refusal'
import { useTeacherList } from './hooks'
import './teacher-files.css'
import '@/features/teachers/rows.css'
import { TeachersTabs } from '@/features/supervision/TeachersTabs'
import { AddTeacherDialog } from './AddTeacherDialog'
import { currentMonth, teacherAreaLinks } from './TeacherWork'
import type { TeacherSummary } from './api'

/** PD-43: an active teacher with set-up steps still open (a teacher who left is not being set up). */
const setupIncomplete = (t: TeacherSummary) => t.isActive && (t.setupMissing ?? 0) > 0

/** PD-43 §3.7: Organization's Teachers & supervisors tab, in the area this list was opened from. */
const assignSupervisorPath = (basePath: string) => `${basePath.startsWith('/admin/') ? '/admin/teams' : '/organization'}?tab=teachers`

type Show = 'all' | 'setup' | 'unsupervised'

/**
 * PD-10: the roster of teachers, for the Teachers department and the super
 * admin. A row is a person: the name, what still needs doing about them as a
 * tag, how many students they hold, and the way into their file. The list
 * carries nothing personal; the file is one click on.
 */
export function TeacherFilesPage({ basePath, eyebrow }: { basePath: string; eyebrow?: string }) {
  const tx = useCopy()
  const { t, number } = useI18n()
  const navigate = useNavigate()
  const list = useTeacherList()
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [show, setShow] = useState<Show>('all')
  // PD-43: offered only when the server says so.
  const offer = list.data?.onboarding
  // The "no supervisor" view and its shortcut are the Manager's and the super admin's (they assign supervisors).
  const assigns = offer?.supervisorChoice === 'any'
  const all = useMemo(() => list.data?.teachers ?? [], [list.data])
  const unsupervised = all.filter((x) => x.unsupervised).length
  const incomplete = all.filter(setupIncomplete).length
  const links = teacherAreaLinks(basePath)
  const view: Show = show === 'unsupervised' && !assigns ? 'all' : show

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all
      .filter((x) => !q || x.name.toLowerCase().includes(q))
      .filter((x) => view !== 'setup' || setupIncomplete(x))
      .filter((x) => view !== 'unsupervised' || x.unsupervised)
  }, [all, query, view])

  // Who supervises each teacher, where the viewer may read the organization; otherwise the row says less.
  const assignments = useTeacherAssignments(true)
  const supervisorOf = useMemo(
    () => new Map((assignments.data?.teachers ?? []).map((a) => [a.id, a.supervisor?.name ?? null] as const)),
    [assignments.data],
  )

  return (
    <div className="page tf-roster">
      <div className="page__inner">
        <PageHeader
          eyebrow={eyebrow}
          title={tx(basePath.startsWith('/admin') ? T.title : T.filesTitle)}
          actions={
            <>
              {assigns && unsupervised > 0 && (
                <Link className="btn" to={assignSupervisorPath(basePath)}>
                  {tx(T.assignSupervisor)}
                </Link>
              )}
              {offer?.canAdd && (
                <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
                  {tx(T.addTeacher)}
                </button>
              )}
            </>
          }
          /* A tab of the Teachers area for operators; of Admin › Teachers for the super admin. */
          tabs={<TeachersTabs basePath={basePath} />}
        />
        {isTeacherFileRefusal(list.error) ? (
          <Refusal error={list.error} />
        ) : (
          <QueryBoundary isLoading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            <section className="sheet" aria-label={tx(T.title)}>
              <div className="sheet-bar">
                <SearchField value={query} onChange={setQuery} label={tx(T.search)} clearLabel={t('common.cancel')} />
                <FilterChips<Show>
                  label={tx(T.status)}
                  value={view}
                  onChange={setShow}
                  formatCount={number}
                  options={[
                    { value: 'all', label: tx(T.rosterAll) },
                    { value: 'setup', label: tx(T.setupIncomplete), count: incomplete },
                    ...(assigns ? [{ value: 'unsupervised' as const, label: tx(T.noSupervisorBadge), count: unsupervised }] : []),
                  ]}
                />
              </div>
              {rows.length === 0 ? (
                <EmptyState title={tx(T.noTeachers)} hint={tx(T.noTeachersHint)} />
              ) : (
                <table className="rowlist">
                  <thead>
                    <tr>
                      <th scope="col">{tx(T.name)}</th>
                      <th scope="col">{tx(T.students)}</th>
                      <th scope="col">{tx(T.status)}</th>
                      <th scope="col">{tx(T.openFile)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const to = `${basePath}/${encodeURIComponent(row.id)}`
                      const more: MenuItem[] = links
                        ? [
                            { key: 'stats', label: tx(T.rowStats), icon: 'chart', onSelect: () => navigate(links.stats(row.id, currentMonth())) },
                            { key: 'schedule', label: tx(T.rowSchedule), icon: 'calendar', onSelect: () => navigate(links.schedule(row.id)) },
                          ]
                        : []
                      return (
                        <tr key={row.id}>
                          <td className="rw-who">
                            <Avatar name={row.name} seed={row.id} />
                            <span className="rw-who__text">
                              <Link className="rw-name" to={to}>
                                <bdi>{row.name}</bdi>
                              </Link>
                              <span className="rw-sub">
                                {!row.isActive
                                  ? tx(T.inactive)
                                  : supervisorOf.get(row.id)
                                    ? <>{tx(T.rowSupervisedBy)} <bdi>{supervisorOf.get(row.id)}</bdi></>
                                    : tx(T.active)}
                              </span>
                            </span>
                          </td>
                          <td className="rw-fact">
                            <span className={row.studentCount > 0 ? 'rw-fact__n' : 'rw-fact__n rw-fact__n--quiet'}>{number(row.studentCount)}</span>
                            <span className="rw-fact__label">{tx(T.students)}</span>
                          </td>
                          <td className="rw-tags rw-meta">
                            <AwayBadge away={row.away} />
                            {row.openComplaints > 0 && (
                              <Badge tone="warn">{row.openComplaints === 1 ? tx(T.oneOpenComplaint) : tx(T.nOpenComplaints, { n: number(row.openComplaints) })}</Badge>
                            )}
                            {row.unsupervised && <Badge tone="warn">{tx(T.noSupervisorBadge)}</Badge>}
                            {setupIncomplete(row) && <Badge tone="warn">{tx(T.setupIncomplete)}</Badge>}
                            {row.signIn === 'none' && <Badge tone="outline">{tx(T.noSignIn)}</Badge>}
                          </td>
                          <td className="cell-actions">
                            <RowActions
                              primary={
                                <Link className="btn btn--sm" to={to}>
                                  {tx(T.openFile)}
                                </Link>
                              }
                              more={more}
                              label={tx(T.moreFor, { name: row.name })}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </section>
            <p className="list-footnote">{tx(T.subtitle)}</p>
          </QueryBoundary>
        )}
        {adding && offer && <AddTeacherDialog offer={offer} basePath={basePath} onClose={() => setAdding(false)} />}
      </div>
    </div>
  )
}
