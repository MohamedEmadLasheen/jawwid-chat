import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { PageHeader } from '@/shared/components/PageHeader'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { T, useCopy } from './copy'
import { Refusal, isTeacherFileRefusal } from './Refusal'
import { useTeacherList } from './hooks'
import './teacher-files.css'
import { TeachersTabs } from '@/features/supervision/TeachersTabs'

/**
 * PD-10: every teacher of the organization, for the Teachers department and
 * the super admin. The list carries nothing personal; the file is one click on.
 */
export function TeacherFilesPage({ basePath, eyebrow }: { basePath: string; eyebrow?: string }) {
  const tx = useCopy()
  const { t, number } = useI18n()
  const list = useTeacherList()
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (list.data?.teachers ?? []).filter((x) => !q || x.name.toLowerCase().includes(q))
  }, [list.data, query])

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
              <span className="toolbar__count">{tx(T.count, { n: number(rows.length) })}</span>
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
                          <Badge tone={row.isActive ? 'ok' : 'outline'} dot>
                            {tx(row.isActive ? T.active : T.inactive)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryBoundary>
        )}
      </div>
    </div>
  )
}
