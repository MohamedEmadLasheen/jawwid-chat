import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { AwayBadge } from './Complaint'
import { PageHeader } from '@/shared/components/PageHeader'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { T, useCopy } from './copy'
import { Refusal, isTeacherFileRefusal } from './Refusal'
import { useTeacherList } from './hooks'
import './teacher-files.css'
import { TeachersTabs } from '@/features/supervision/TeachersTabs'
import { AddTeacherDialog } from './AddTeacherDialog'
import type { TeacherSummary } from './api'

/** PD-43: an active teacher with set-up steps still open (a teacher who left is not being set up). */
const setupIncomplete = (t: TeacherSummary) => t.isActive && (t.setupMissing ?? 0) > 0

/**
 * PD-10: every teacher of the organization, for the Teachers department and
 * the super admin. The list carries nothing personal; the file is one click on.
 */
export function TeacherFilesPage({ basePath, eyebrow }: { basePath: string; eyebrow?: string }) {
  const tx = useCopy()
  const { t, number } = useI18n()
  const list = useTeacherList()
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  // PD-43: the active teachers still being set up.
  const [incompleteOnly, setIncompleteOnly] = useState(false)
  // PD-43: offered only when the server says so.
  const offer = list.data?.onboarding

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (list.data?.teachers ?? [])
      .filter((x) => !q || x.name.toLowerCase().includes(q))
      .filter((x) => !incompleteOnly || setupIncomplete(x))
  }, [list.data, query, incompleteOnly])

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader eyebrow={eyebrow} title={tx(T.title)} subtitle={tx(T.subtitle)} />
        {/* A tab of the Teachers area for operators; of Admin › Teachers for the super admin. */}
        <TeachersTabs basePath={basePath} />
        {isTeacherFileRefusal(list.error) ? (
          <Refusal error={list.error} />
        ) : (
          <QueryBoundary isLoading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            <div className="toolbar">
              <SearchField value={query} onChange={setQuery} label={tx(T.search)} clearLabel={t('common.cancel')} />
              <label className="tf-radio">
                <input type="checkbox" checked={incompleteOnly} onChange={(e) => setIncompleteOnly(e.target.checked)} />
                {tx(T.setupIncompleteOnly)}
              </label>
              <span className="toolbar__count">{tx(T.count, { n: number(rows.length) })}</span>
              {offer?.canAdd && (
                <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
                  {tx(T.addTeacher)}
                </button>
              )}
            </div>
            {rows.length === 0 ? (
              <EmptyState title={tx(T.noTeachers)} />
            ) : (
              <div className="table-wrap tf-table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{tx(T.name)}</th>
                      <th scope="col">{tx(T.students)}</th>
                      <th scope="col">{tx(T.openComplaints)}</th>
                      <th scope="col">{tx(T.status)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td dir="auto">
                          <Link to={`${basePath}/${encodeURIComponent(row.id)}`}>{row.name}</Link>
                        </td>
                        <td>{number(row.studentCount)}</td>
                        <td>
                          {row.openComplaints > 0 ? (
                            <Badge tone="warn" dot>
                              {number(row.openComplaints)}
                            </Badge>
                          ) : (
                            number(0)
                          )}
                        </td>
                        <td>
                          <span className="tf-badges">
                            <Badge tone={row.isActive ? 'ok' : 'outline'} dot>
                              {tx(row.isActive ? T.active : T.inactive)}
                            </Badge>
                            <AwayBadge away={row.away} />
                            {row.signIn === 'none' && <Badge tone="outline">{tx(T.noSignIn)}</Badge>}
                            {setupIncomplete(row) && <Badge tone="warn">{tx(T.setupIncomplete)}</Badge>}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryBoundary>
        )}
        {adding && offer && <AddTeacherDialog offer={offer} basePath={basePath} onClose={() => setAdding(false)} />}
      </div>
    </div>
  )
}
