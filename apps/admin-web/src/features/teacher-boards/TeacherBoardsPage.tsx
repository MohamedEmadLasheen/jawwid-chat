import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '@/core/api/errors'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { PageHeader } from '@/shared/components/PageHeader'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { TeachersTabs } from '@/features/supervision/TeachersTabs'
import { B, useCopy } from './copy'
import { useBoardTeachers, useTeacherBoards } from './hooks'
import './teacher-boards.css'
import '@/features/teachers/rows.css'
import { Icon } from '@/shared/components/Icon'

/**
 * PD-39 §10 1b, 4a: a teacher's boards, for the staff who may read them --
 * the teacher's supervisor, their active backup, the Teachers Manager and the
 * super admin (the server decides each teacher; anyone else gets 404). A
 * departed teacher is still listed: their boards are kept for 12 months.
 * Read only: nothing here edits, deletes or restores a board.
 */
export function TeacherBoardsPage({ basePath }: { basePath: string }) {
  const tx = useCopy()
  const { date, number } = useI18n()
  const [params, setParams] = useSearchParams()
  const teacherId = params.get('teacher')
  const directory = useBoardTeachers()
  const boards = useTeacherBoards(teacherId)
  const teachers = directory.data?.teachers ?? []
  const forbidden = boards.error instanceof ApiError && (boards.error.isNotFound || boards.error.isForbidden)

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader
          title={tx(B.title)}
          subtitle={tx(B.subtitle)}
          figures={teacherId && boards.data ? [{ key: 'boards', label: tx(B.tab), value: number(boards.data.length), tone: 'key' }] : undefined}
          tabs={<TeachersTabs basePath={basePath} />}
        />
        <section className="sheet" aria-label={tx(B.title)}>
          {/* Whose boards: the one control the list answers to. */}
          <div className="sheet-bar tb-bar">
            <div className="tb-picker field">
              <label className="field__label" htmlFor="tb-teacher">
                {tx(B.teacher)}
              </label>
              <SearchableSelect
                id="tb-teacher"
                className="input"
                value={teacherId ?? ''}
                disabled={directory.isLoading}
                onValueChange={(v) => setParams(v ? { teacher: v } : {}, { replace: true })}
              >
                <option value="">{tx(B.chooseTeacher)}</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.isActive ? t.name : tx(B.departed, { name: t.name })}
                  </option>
                ))}
              </SearchableSelect>
            </div>
          </div>
          {!teacherId ? (
            <EmptyState title={tx(B.chooseTeacher)} hint={tx(B.chooseTeacherHint)} />
          ) : forbidden ? (
            <EmptyState title={tx(B.notYours)} hint={tx(B.notYoursHint)} />
          ) : (
            <QueryBoundary
              isLoading={boards.isLoading}
              error={boards.error}
              onRetry={() => void boards.refetch()}
              isEmpty={boards.data?.length === 0}
              emptyTitle={tx(B.noBoards)}
              emptyHint={tx(B.noBoardsHint)}
            >
              <ul className="tb-list">
                {boards.data?.map((b) => {
                  const to = `${basePath}/boards/${encodeURIComponent(b.id)}`
                  return (
                    <li key={b.id} className="rowx">
                      <div className="rw-who">
                        <span className="tb-row__icon" aria-hidden="true">
                          <Icon name="notebook" size={18} />
                        </span>
                        <span className="rw-who__text">
                          <Link className="rw-name" to={to}>
                            {b.title}
                          </Link>
                          <span className="rw-sub">{tx(B.updated, { date: date(b.updatedAt) })}</span>
                        </span>
                      </div>
                      <div className="rw-meta">{tx(B.pages, { n: b.pageCount })}</div>
                      <div className="rw-tags">
                        {b.state === 'retained' && b.retainedUntil && <Badge tone="warn">{tx(B.kept, { date: date(b.retainedUntil) })}</Badge>}
                      </div>
                      <div className="cell-actions">
                        <Link className="btn btn--sm" to={to} aria-label={`${tx(B.open)}: ${b.title}`}>
                          {tx(B.open)}
                        </Link>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </QueryBoundary>
          )}
        </section>
      </div>
    </div>
  )
}
