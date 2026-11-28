import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '@/core/api/errors'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { holdsAny } from '@/core/permissions/capabilities'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { PageHeader } from '@/shared/components/PageHeader'
import { RowActions } from '@/shared/components/RowActions'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { TeachersTabs } from '@/features/supervision/TeachersTabs'
import { RETENTION_KEYS, type BoardSummary } from './api'
import { CopyDialog } from './BoardViewerPage'
import { B, isolate, useCopy, useDay } from './copy'
import { useBoardTeachers, useTeacherBoards } from './hooks'
import './teacher-boards.css'
import '@/features/teachers/rows.css'

/** A board unchanged this long says so on its row (round 3): a quiet fact, not a warning. */
export const BOARD_STALE_DAYS = 90

/**
 * PD-39 §10 1b, 4a: a teacher's boards, for the staff who may read them --
 * the teacher's supervisor, their active backup, the Teachers Manager and the
 * super admin (the server decides each teacher; anyone else gets 404). A
 * departed teacher is still listed: their boards are kept for 12 months.
 * Read only: nothing here edits, deletes or restores a board. The one write,
 * the Teachers Manager's copy of a departed teacher's board, is the viewer's.
 *
 * Opening a teacher's list is logged, so nothing is listed until a teacher is
 * chosen; before that the page lists the teachers (names only, not logged),
 * the departed first: their boards are the ones with a deadline.
 */
export function TeacherBoardsPage({ basePath }: { basePath: string }) {
  const tx = useCopy()
  const { number } = useI18n()
  const date = useDay()
  const { staff } = useSession()
  const retention = holdsAny(staff, RETENTION_KEYS)
  const [params, setParams] = useSearchParams()
  const teacherId = params.get('teacher')
  const directory = useBoardTeachers()
  const boards = useTeacherBoards(teacherId)
  const teachers = directory.data?.teachers ?? []
  const teacher = teachers.find((t) => t.id === teacherId)
  const forbidden = boards.error instanceof ApiError && (boards.error.isNotFound || boards.error.isForbidden)
  const [copying, setCopying] = useState<BoardSummary | null>(null)

  // The latest change first: what has gone quiet sinks to the end, where its tag says for how long.
  const rows = useMemo(() => [...(boards.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [boards.data])
  const keptUntil = rows
    .filter((b) => b.state === 'retained' && b.retainedUntil)
    .map((b) => b.retainedUntil as string)
    .sort()[0]
  const byNeed = useMemo(() => [...teachers].sort((a, b) => Number(a.isActive) - Number(b.isActive)), [teachers])

  const untouched = (b: BoardSummary) => {
    const days = Math.floor((Date.now() - Date.parse(b.updatedAt)) / 86_400_000)
    if (!(days >= BOARD_STALE_DAYS)) return null
    const months = Math.floor(days / 30)
    return tx(months > 10 ? B.untouchedMany : B.untouched, { n: number(months) })
  }

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader title={tx(B.title)} subtitle={tx(B.subtitle)} tabs={<TeachersTabs basePath={basePath} />} />
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
            {!teacherId && <p className="tb-muted tb-bar__hint">{tx(B.teachersHint)}</p>}
          </div>
          {!teacherId ? (
            <QueryBoundary
              isLoading={directory.isLoading}
              error={directory.error}
              onRetry={() => void directory.refetch()}
              isEmpty={teachers.length === 0}
              emptyTitle={tx(B.noTeachers)}
              emptyHint={tx(B.noTeachersHint)}
            >
              <ul className="tb-list" aria-label={tx(B.teachersHead)}>
                {byNeed.map((t) => (
                  <li key={t.id} className="rowx">
                    <div className="rw-who">
                      <Avatar name={t.name} seed={t.id} />
                      <span className="rw-who__text">
                        <span className="rw-name">
                          <bdi>{t.name}</bdi>
                        </span>
                      </span>
                    </div>
                    <div className="rw-tags">{!t.isActive && <Badge tone="warn">{tx(B.leftTag)}</Badge>}</div>
                    <div className="cell-actions">
                      <Link className="btn btn--sm" to={`?teacher=${encodeURIComponent(t.id)}`} replace aria-label={`${tx(B.showBoards)}: ${t.name}`}>
                        {tx(B.showBoards)}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </QueryBoundary>
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
              {/* A departed teacher's deadline is the teacher's, said once above their boards. */}
              {keptUntil && (
                <p className="tb-kept" role="note">
                  {tx(B.leftNotice, { name: isolate(teacher?.name ?? tx(B.teacher)), date: date(keptUntil) })}
                </p>
              )}
              <ul className="tb-list">
                {rows.map((b) => {
                  const to = `${basePath}/boards/${encodeURIComponent(b.id)}`
                  const quiet = untouched(b)
                  return (
                    <li key={b.id} className="rowx">
                      <div className="rw-who">
                        <span className="rw-who__text">
                          <Link className="rw-name" to={to}>
                            {b.title}
                          </Link>
                          <span className="rw-sub">{tx(B.updated, { date: date(b.updatedAt) })}</span>
                        </span>
                      </div>
                      <div className="rw-meta tb-pages">{b.pageCount > 0 ? tx(B.pages, { n: number(b.pageCount) }) : null}</div>
                      <div className="rw-tags">
                        {b.pageCount === 0 && <Badge tone="outline">{tx(B.emptyBoard)}</Badge>}
                        {quiet && <Badge tone="outline">{quiet}</Badge>}
                      </div>
                      <div className="cell-actions">
                        <RowActions
                          primary={
                            <Link className="btn btn--sm" to={to} aria-label={`${tx(B.open)}: ${b.title}`}>
                              {tx(B.open)}
                            </Link>
                          }
                          more={
                            retention && b.state === 'retained' && b.retainedUntil
                              ? [{ key: 'copy', label: tx(B.copy), icon: 'copy', onSelect: () => setCopying(b) }]
                              : []
                          }
                          label={tx(B.more, { title: b.title })}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </QueryBoundary>
          )}
        </section>
        {copying && teacherId && <CopyDialog board={{ ...copying, teacherId }} onClose={() => setCopying(null)} />}
      </div>
    </div>
  )
}
