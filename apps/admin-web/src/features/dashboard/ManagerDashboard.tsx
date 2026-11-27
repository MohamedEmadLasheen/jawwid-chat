import { Link } from 'react-router-dom'
import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { ApiError } from '@/core/api/errors'
import { useSession } from '@/core/auth/SessionProvider'
import { useI18n } from '@/core/i18n/I18nProvider'
import { TEXT, fill, relativeTime, useText } from '@/features/admin/copy'
import { Icon } from '@/shared/components/Icon'
import { Skeleton } from '@/shared/components/Skeleton'
import { dashboardApi, dashboardKeys, type DashboardSection, type DashboardTile } from './api'
import { D } from './copy'
import { SECTIONS, TILES, sectionAllowed, type SectionSpec } from './registry'
import './dashboard.css'

/**
 * PD-44: polled, not pushed (plan §2.3) -- these counts change through many
 * write paths with no one event, and a minute late is fine. A hidden tab does
 * not poll; focusing the window refetches.
 */
export const DASHBOARD_REFRESH_MS = 60_000

type SectionQuery = UseQueryResult<DashboardSection>

const refused = (error: unknown) => error instanceof ApiError && error.status === 403

/** What a section has to show: the tiles the server sent that this page knows how to name. */
const tilesOf = (data: DashboardSection | undefined): DashboardTile[] => (data?.tiles ?? []).filter((t) => t.key in TILES)

/**
 * The manager Dashboard's sections (PD-44), shared by the managers' /dashboard
 * and the super admin's Admin Portal Dashboard (PR-8, Q7): one section per
 * page it summarises, asked for only with that page's PD-40 key; the server
 * leaves out a tile the person is not covered for, and absent is never drawn
 * as zero.
 */
export function useDashboardSections() {
  const { staff } = useSession()
  const sections = SECTIONS.filter((s) => sectionAllowed(s, staff?.permissions))
  const queries = useQueries({
    queries: sections.map((s) => ({
      queryKey: dashboardKeys.section(s.key),
      queryFn: () => dashboardApi.section(s.key),
      refetchInterval: DASHBOARD_REFRESH_MS,
    })),
  })
  // A section is hidden when the server refused it, or covered the person for
  // none of its tiles; it stays (with its error) when it simply failed.
  const shown = sections
    .map((spec, i) => ({ spec, query: queries[i]! }))
    .filter(({ query }) => !refused(query.error) && !(query.data && tilesOf(query.data).length === 0))
  return {
    /** The sections this person may ask for. */
    asked: sections.length,
    shown,
    settled: queries.every((q) => !q.isLoading),
    updatedAt: Math.max(0, ...queries.map((q) => q.dataUpdatedAt)),
    fetching: queries.some((q) => q.isFetching),
    refetch: () => queries.forEach((q) => void q.refetch()),
  }
}

type Shown = ReturnType<typeof useDashboardSections>['shown']

/** A backlog above zero wants doing; one whose key ends in "overdue" is late as well. */
const isWaiting = (tile: DashboardTile) => TILES[tile.key]!.backlog && tile.count > 0
const isLate = (tile: DashboardTile) => tile.count > 0 && /overdue$/.test(tile.key)

/** How much is waiting across the sections shown: kinds of work, and how many of them are late. */
export function dashboardSummary(shown: Shown): { waiting: number; late: number } {
  const tiles = shown.flatMap(({ query }) => tilesOf(query.data))
  return { waiting: tiles.filter(isWaiting).length, late: tiles.filter((t) => isWaiting(t) && isLate(t)).length }
}

/**
 * The board. At the start, on one sheet: "Needs you now", the sections with
 * something waiting (or that failed to load), the one with a late or the
 * largest figure first, each figure a row to open. At the end, on the canvas:
 * the sections with nothing waiting, as compact groups. Every figure is still
 * one link inside its own section.
 *
 * All the sections are siblings in one list, the waiting ones first, and the
 * stylesheet sets them in two columns: a section that goes from loading to
 * waiting is moved, never rebuilt, so nothing the reader holds is lost.
 */
export function DashboardSections({ shown }: { shown: Shown }) {
  const tx = useText()
  const { number } = useI18n()
  const ranked = shown.map(({ spec, query }) => {
    const waiting = tilesOf(query.data).filter(isWaiting)
    const failed = !query.isLoading && !query.data
    return { spec, query, waiting, failed, late: waiting.some(isLate), most: Math.max(0, ...waiting.map((t) => t.count)) }
  })
  const needs = ranked
    .filter((r) => r.waiting.length > 0 || r.failed)
    .sort((x, y) => Number(y.late) - Number(x.late) || y.most - x.most)
  const calm = ranked.filter((r) => r.waiting.length === 0 && !r.failed)
  const kinds = needs.reduce((n, r) => n + r.waiting.length, 0)
  const settled = shown.every(({ query }) => !query.isLoading)

  return (
    <div className={calm.length > 0 ? 'dash-board' : 'dash-board dash-board--one'}>
      <h2 className="dash-needs__head" id="dash-needs-title">
        {tx(D.needs)}
        {kinds > 0 && <span className="count count--urgent dash-needs__count">{number(kinds)}</span>}
      </h2>
      {needs.length === 0 && <p className="dash-needs__clear">{tx(settled ? D.needsClear : D.needsLoading)}</p>}
      {/* One keyed list: a section that changes column is moved in place, not rebuilt. */}
      {[...needs, ...calm].map(({ spec, query }, i) => (
        <Section key={spec.key} spec={spec} query={query} variant={i < needs.length ? 'needs' : 'calm'} />
      ))}
    </div>
  )
}

function Section({ spec, query, variant }: { spec: SectionSpec; query: SectionQuery; variant: 'needs' | 'calm' }) {
  const tx = useText()
  const { t, time } = useI18n()
  const titleId = `dash-section-${spec.key}`
  const tiles = tilesOf(query.data)
  const present = new Set(tiles.map((x) => x.key))
  // What wants doing is a row to open, the late and the largest first; the section's other figures are plain lines.
  const waiting = tiles.filter(isWaiting).sort((x, y) => Number(isLate(y)) - Number(isLate(x)) || y.count - x.count)
  const rest = tiles.filter((tile) => !isWaiting(tile))

  return (
    <section className={variant === 'needs' ? 'dash-group dash-group--needs' : 'aside-group dash-group dash-group--calm'} aria-labelledby={titleId}>
      <h3 id={titleId} className={variant === 'needs' ? 'dash-group__title' : 'aside-group__title'}>
        {tx(spec.title)}
      </h3>
      {query.isLoading ? (
        <div role="status" aria-live="polite" className="dash-loading">
          <span className="sr-only">{t('common.loading')}</span>
          {[0, 1].map((i) => (
            <Skeleton key={i} height={34} radius={4} />
          ))}
        </div>
      ) : !query.data ? (
        // A figure that failed is never shown as zero.
        <div className="dash-failed" role="alert">
          <span className="dash-failed__text">{tx(D.failed)}</span>
          <button type="button" className="btn btn--sm" onClick={() => void query.refetch()}>
            <Icon name="refresh" size={16} />
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <>
          {/* Figures kept from an earlier read are shown only with this warning. */}
          {query.error && (
            <div className="dash-stale" role="status">
              <span>{fill(tx(TEXT.staleData), { time: time(new Date(query.dataUpdatedAt).toISOString()) })}</span>
              <button type="button" className="btn btn--sm" onClick={() => void query.refetch()}>
                {t('common.retry')}
              </button>
            </div>
          )}
          {tiles.every((tile) => tile.count === 0) ? (
            <p className="dash-section__clear">{tx(D.allClear)}</p>
          ) : (
            <>
              {waiting.length > 0 && (
                <ul className="dash-rows">
                  {waiting.map((tile) => (
                    <Figure key={tile.key} tile={tile} present={present} large />
                  ))}
                </ul>
              )}
              {rest.length > 0 && (
                <ul className="dash-lines">
                  {rest.map((tile) => (
                    <Figure key={tile.key} tile={tile} present={present} />
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

/** One figure and the page that resolves it: a row to open when it is waiting, a line otherwise. Always one link. */
function Figure({ tile, present, large = false }: { tile: DashboardTile; present: ReadonlySet<string>; large?: boolean }) {
  const tx = useText()
  const { number, locale } = useI18n()
  const spec = TILES[tile.key]!
  const alert = spec.backlog && tile.count > 0
  const shape = large ? 'dash-tile dash-tile--large' : 'dash-tile dash-tile--line'
  // A late figure above zero is terracotta, here as on Today (overdue instalments, tasks, cases).
  const tone = (alert ? ' dash-tile--alert' : tile.count === 0 ? ' dash-tile--zero' : '') + (isLate(tile) ? ' dash-tile--late' : '')
  return (
    <li>
      <Link to={spec.href(present)} className={shape + tone}>
        <span className="dash-tile__value">{tile.capped ? `${number(tile.count)}+` : number(tile.count)}</span>
        <span className="dash-tile__text">
          <span className="dash-tile__label">{tx(spec.label)}</span>
          {tile.oldestAt && tile.count > 0 && (
            <span className="dash-tile__note">{fill(tx(D.oldest), { age: relativeTime(tile.oldestAt, locale) })}</span>
          )}
        </span>
        {large && (
          <span className="dash-tile__go" aria-hidden="true">
            {tx(D.open)}
            <Icon name="chevronForward" size={14} />
          </span>
        )}
      </Link>
    </li>
  )
}
