import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '@/core/api/errors'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { holdsAny } from '@/core/permissions/capabilities'
import { Badge } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { PageHeader } from '@/shared/components/PageHeader'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { EmptyState, ErrorState, QueryBoundary } from '@/shared/components/States'
import { TeachersTabs } from '@/features/supervision/TeachersTabs'
import type { Pair } from '@/features/organization/copy'
import { newIdempotencyKey } from '@/core/api/client'
import { RETENTION_KEYS, type BoardDetail } from './api'
import { parsePage, type BoardElement, type BoardPage, type VerseLookup } from './board'
import { BoardCanvas } from './BoardCanvas'
import { ACTION, B, BASIS, useCopy } from './copy'
import { useAccessLog, useBoardImages, useBoardTeachers, useCopyBoard, useTeacherBoard, useVerseTexts } from './hooks'
import type { ImageLookup } from './render'
import './teacher-boards.css'

/**
 * PD-39 §10 1b-1d, 4a-4b: one teacher's board, read only. No tools, no
 * autosave, no trash: the only write is the Teachers Manager's copy of a
 * departed teacher's board to another teacher, and the original is unchanged.
 * Opening it is logged by the server; so is reading its access history, which
 * is therefore asked for only on request.
 */
export function BoardViewerPage({ basePath }: { basePath: string }) {
  const tx = useCopy()
  const { boardId = '' } = useParams()
  const board = useTeacherBoard(boardId)
  const missing = board.error instanceof ApiError && (board.error.isNotFound || board.error.isForbidden)

  return (
    <div className="page">
      <div className="page__inner">
        {board.data ? (
          <Viewer board={board.data} basePath={basePath} />
        ) : (
          <>
            <PageHeader title={tx(B.title)} />
            <TeachersTabs basePath={basePath} />
            {missing ? (
              <EmptyState title={tx(B.boardNotFound)} hint={tx(B.notYoursHint)} />
            ) : (
              <QueryBoundary isLoading={board.isLoading} error={board.error} onRetry={() => void board.refetch()}>
                {null}
              </QueryBoundary>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Viewer({ board, basePath }: { board: BoardDetail; basePath: string }) {
  const tx = useCopy()
  const { date } = useI18n()
  const { staff } = useSession()
  const retention = holdsAny(staff, RETENTION_KEYS)
  // Only the page on view is decoded (its strokes can be large); the rest wait until they are shown.
  const pages = useMemo(() => [...board.pages].sort((a, b) => a.position - b.position), [board.pages])
  const [index, setIndex] = useState(0)
  const shown = pages[Math.min(index, pages.length - 1)]
  const page = useMemo(() => (shown ? parsePage(shown as unknown as Record<string, unknown>) : null), [shown])
  const verse = useVerseTexts(page)
  // Only the page on view's images are loaded, as its strokes are (review of #336).
  const pageImages = useMemo(() => (page?.elements ?? []).flatMap((e) => (e.kind === 'image' ? [e.assetId] : [])), [page])
  const image = useBoardImages(board.assets, pageImages)
  const directory = useBoardTeachers()
  const teacherName = directory.data?.teachers.find((t) => t.id === board.teacherId)?.name
  const [copying, setCopying] = useState(false)

  const label = useCallback(
    (e: BoardElement, found?: VerseLookup | ImageLookup) => {
      if (e.kind === 'verse') return tx(found?.status === 'changed' ? B.verseChanged : found?.status === 'loading' ? B.verseLoading : B.verseUnavailable)
      if (e.kind === 'image') return tx(found?.status === 'loading' ? B.imageLoading : B.imageUnavailable)
      return tx(B.unknownKind, { kind: e.kind === 'opaque' ? e.type : e.kind })
    },
    [tx],
  )

  // The dataset's credit, wherever its text is shown (PD-29).
  const sources = useMemo(() => {
    const out = new Set<string>()
    for (const e of page?.elements ?? []) {
      if (e.kind !== 'verse') continue
      const found = verse(e.ref)
      if (found.status === 'ready' && found.text.dataset.attribution) out.add(found.text.dataset.attribution)
    }
    return [...out]
  }, [page, verse])

  const retained = board.state === 'retained' && board.retainedUntil

  return (
    <>
      <PageHeader
        eyebrow={teacherName}
        title={board.title}
        status={<Badge tone="outline">{tx(B.readOnly)}</Badge>}
        subtitle={tx(B.subtitle)}
        actions={
          <>
            <Link className="btn btn--ghost btn--sm" to={`${basePath}/boards?teacher=${encodeURIComponent(board.teacherId)}`}>
              {tx(B.allBoards)}
            </Link>
            {retained && retention && (
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setCopying(true)}>
                {tx(B.copy)}
              </button>
            )}
          </>
        }
      />
      <TeachersTabs basePath={basePath} />
      {retained && (
        <p className="tb-kept">
          <Badge tone="warn" dot>
            {tx(B.kept, { date: date(board.retainedUntil as string) })}
          </Badge>{' '}
          {tx(B.keptHint, { date: date(board.retainedUntil as string) })}
        </p>
      )}
      {page ? (
        <section className="tb-viewer">
          <BoardCanvas page={page} verse={verse} image={image} label={label} ariaLabel={tx(B.canvasLabel, { n: index + 1, title: board.title })} />
          <PageText page={page} />
          <div className="tb-pager">
            <button type="button" className="btn btn--ghost btn--sm" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
              {tx(B.previousPage)}
            </button>
            <span aria-live="polite">{tx(B.pageOf, { n: index + 1, m: pages.length })}</span>
            <button type="button" className="btn btn--ghost btn--sm" disabled={index >= pages.length - 1} onClick={() => setIndex((i) => i + 1)}>
              {tx(B.nextPage)}
            </button>
          </div>
          {sources.map((s) => (
            <p key={s} className="tb-source">
              {tx(B.quranSource, { source: s })}
            </p>
          ))}
        </section>
      ) : (
        <EmptyState title={tx(B.noPages)} />
      )}
      {retention && <AccessHistory boardId={board.id} />}
      {copying && <CopyDialog board={board} onClose={() => setCopying(false)} />}
    </>
  )
}

function AccessHistory({ boardId }: { boardId: string }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  const [open, setOpen] = useState(false)
  const log = useAccessLog(boardId, open)
  // A value this build has no words for is shown as it came, never hidden.
  const named = (pair: Pair | undefined, raw: string) => (pair ? tx(pair) : raw)
  return (
    <section className="card tb-history">
      <div className="card__header">
        <h2 className="card__title">{tx(B.history)}</h2>
      </div>
      {!open ? (
        <p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(true)}>
            {tx(B.showHistory)}
          </button>{' '}
          <span className="tb-muted">{tx(B.historyNote)}</span>
        </p>
      ) : (
        <QueryBoundary isLoading={log.isLoading} error={log.error} compact isEmpty={log.data?.length === 0} emptyTitle={tx(B.historyEmpty)}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{tx(B.colWhen)}</th>
                  <th scope="col">{tx(B.colWho)}</th>
                  <th scope="col">{tx(B.colAs)}</th>
                  <th scope="col">{tx(B.colAction)}</th>
                </tr>
              </thead>
              <tbody>
                {log.data?.map((row, i) => (
                  <tr key={`${row.at}-${i}`}>
                    <td>{dateTime(row.at)}</td>
                    <td>
                      {row.viewerKind === 'system'
                        ? tx(B.system)
                        : row.viewerKind === 'support_session'
                          ? tx(B.supportBy, { name: row.viewerName ?? tx(B.someone) })
                          : (row.viewerName ?? tx(B.someone))}
                    </td>
                    <td>{named(BASIS[row.basis], row.basis)}</td>
                    <td>{named(ACTION[row.action], row.action)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryBoundary>
      )}
    </section>
  )
}

function CopyDialog({ board, onClose }: { board: BoardDetail; onClose: () => void }) {
  const tx = useCopy()
  const { date, t } = useI18n()
  const directory = useBoardTeachers()
  const copy = useCopyBoard(board.id)
  const [target, setTarget] = useState('')
  // One key per intended copy: a retry (a double click, a lost answer) answers the same copy.
  const key = useMemo(() => newIdempotencyKey(), [target])
  // Only the server's copy targets: the organization's active teachers, for who may copy.
  const active = (directory.data?.copyTargets ?? []).filter((t) => t.id !== board.teacherId)
  const chosen = active.find((t) => t.id === target)
  return (
    <Dialog
      title={tx(B.copyTitle, { title: board.title })}
      onClose={onClose}
      footer={
        copy.isSuccess ? (
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {t('common.close')}
          </button>
        ) : (
          <>
            <DialogCancelButton onClick={onClose} disabled={copy.isPending} />
            <button type="button" className="btn btn--primary" disabled={!target || copy.isPending} onClick={() => copy.mutate({ teacherId: target, key })}>
              {tx(B.copyConfirm)}
            </button>
          </>
        )
      }
    >
      {copy.isSuccess ? (
        <p role="status">{tx(B.copied, { teacher: chosen?.name ?? '', title: board.title })}</p>
      ) : (
        <>
          <p>{tx(B.copyBody, { date: board.retainedUntil ? date(board.retainedUntil) : '' })}</p>
          <div className="field">
            <label className="field__label" htmlFor="tb-copy-to">
              {tx(B.copyTo)}
            </label>
            <SearchableSelect id="tb-copy-to" className="input" value={target} onValueChange={(v) => setTarget(v)}>
              <option value="">{tx(B.chooseTeacher)}</option>
              {active.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SearchableSelect>
          </div>
          {copy.error ? <ErrorState error={copy.error} compact /> : null}
        </>
      )}
    </Dialog>
  )
}

/**
 * What the page says, for a screen reader: the canvas is one picture, so its
 * words and its verses are listed as text too (hidden on screen). A verse is
 * named by its reference, never by text the page did not check.
 */
function PageText({ page }: { page: BoardPage }) {
  const tx = useCopy()
  const items = page.elements.flatMap((e) => {
    if (e.kind === 'text' && e.text.trim()) return [e.text]
    if (e.kind === 'stamp' && e.text) return [e.text]
    if (e.kind === 'verse') return [tx(B.verseRef, { surah: e.ref.surah, from: e.ref.fromAyah, to: e.ref.toAyah })]
    return []
  })
  if (items.length === 0) return null
  return (
    <ul className="sr-only" aria-label={tx(B.pageText)}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}
