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

/** The sections `useDashboardSections` decided to show, in the registry's order. */
export function DashboardSections({ shown }: { shown: ReturnType<typeof useDashboardSections>['shown'] }) {
  return (
    <div className="dash-book">
      {shown.map(({ spec, query }) => (
        <Section key={spec.key} spec={spec} query={query} />
      ))}
    </div>
  )
}

function Section({ spec, query }: { spec: SectionSpec; query: SectionQuery }) {
  const tx = useText()
  const { t, time } = useI18n()
  const titleId = `dash-section-${spec.key}`
  const tiles = tilesOf(query.data)
  const present = new Set(tiles.map((x) => x.key))
  // What wants doing is set large; the section's other figures are plain lines under it.
  const waiting = tiles.filter((tile) => TILES[tile.key]!.backlog && tile.count > 0)
  const rest = tiles.filter((tile) => !waiting.includes(tile))

  return (
    <section className="dash-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="dash-section__title">
        {tx(spec.title)}
      </h2>
      <div className="dash-section__body">
        {query.isLoading ? (
          <div role="status" aria-live="polite" className="dash-loading">
            <span className="sr-only">{t('common.loading')}</span>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={58} radius={4} />
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
                  <ul className="dash-ledger">
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
      </div>
    </section>
  )
}

/** One figure and the page that resolves it: a large numeral when it is waiting, a line otherwise. */
function Figure({ tile, present, large = false }: { tile: DashboardTile; present: ReadonlySet<string>; large?: boolean }) {
  const tx = useText()
  const { number, locale } = useI18n()
  const spec = TILES[tile.key]!
  const alert = spec.backlog && tile.count > 0
  const shape = large ? 'dash-tile dash-tile--large' : 'dash-tile dash-tile--line'
  const tone = alert ? ' dash-tile--alert' : tile.count === 0 ? ' dash-tile--zero' : ''
  return (
    <li>
      <Link to={spec.href(present)} className={shape + tone}>
        <span className="dash-tile__label">{tx(spec.label)}</span>
        <span className="dash-tile__value">{tile.capped ? `${number(tile.count)}+` : number(tile.count)}</span>
        {tile.oldestAt && tile.count > 0 && (
          <span className="dash-tile__note">{fill(tx(D.oldest), { age: relativeTime(tile.oldestAt, locale) })}</span>
        )}
      </Link>
    </li>
  )
}
