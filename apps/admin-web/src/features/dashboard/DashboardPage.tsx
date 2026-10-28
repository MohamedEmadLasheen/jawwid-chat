import { Link } from 'react-router-dom'
import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { ApiError } from '@/core/api/errors'
import { useSession } from '@/core/auth/SessionProvider'
import { useI18n } from '@/core/i18n/I18nProvider'
import { RefreshAction } from '@/features/admin/common'
import { TEXT, fill, relativeTime, useText } from '@/features/admin/copy'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { Skeleton } from '@/shared/components/Skeleton'
import { EmptyState } from '@/shared/components/States'
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
 * The manager Dashboard (PD-44): what is waiting, as counts, each a link to
 * the page where it is resolved. One section per page it summarises, asked
 * for only with that page's PD-40 key; the server leaves out a tile the
 * person is not covered for, and absent is never drawn as zero.
 */
export function DashboardPage() {
  const tx = useText()
  const { t } = useI18n()
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
  const settled = queries.every((q) => !q.isLoading)
  const updatedAt = Math.max(0, ...queries.map((q) => q.dataUpdatedAt))

  return (
    <div className="page dash">
      <div className="page__inner">
        <PageHeader
          title={t('nav.dashboard')}
          subtitle={tx(D.subtitle)}
          actions={
            sections.length > 0 && (
              <RefreshAction
                updatedAt={updatedAt}
                fetching={queries.some((q) => q.isFetching)}
                onRefresh={() => queries.forEach((q) => void q.refetch())}
              />
            )
          }
        />
        {sections.length === 0 || (settled && shown.length === 0) ? (
          <EmptyState title={tx(D.noSections)} />
        ) : (
          shown.map(({ spec, query }) => <Section key={spec.key} spec={spec} query={query} />)
        )}
      </div>
    </div>
  )
}

function Section({ spec, query }: { spec: SectionSpec; query: SectionQuery }) {
  const tx = useText()
  const { t, time } = useI18n()
  const titleId = `dash-section-${spec.key}`
  const tiles = tilesOf(query.data)

  return (
    <section className="dash-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="dash-section__title">
        {tx(spec.title)}
      </h2>
      {query.isLoading ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{t('common.loading')}</span>
          <div className="kpi-grid">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={118} radius={12} />
            ))}
          </div>
        </div>
      ) : !query.data ? (
        // A figure that failed is never shown as zero.
        <div className="state state--compact" role="alert">
          <span className="state__icon" aria-hidden="true">
            <Icon name="alert" size={22} />
          </span>
          <div className="state__title">{tx(D.failed)}</div>
          <button type="button" className="btn btn--sm" onClick={() => void query.refetch()}>
            <Icon name="refresh" size={16} />
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <>
          {/* Figures kept from an earlier read are shown only with this warning. */}
          {query.error && (
            <div className="stale-banner" role="status">
              <Icon name="alert" size={16} />
              <span>{fill(tx(TEXT.staleData), { time: time(new Date(query.dataUpdatedAt).toISOString()) })}</span>
              <button type="button" className="btn btn--sm" onClick={() => void query.refetch()}>
                {t('common.retry')}
              </button>
            </div>
          )}
          {tiles.every((tile) => tile.count === 0) ? (
            <p className="dash-section__clear">
              <Icon name="check" size={16} />
              {tx(D.allClear)}
            </p>
          ) : (
            <ul className="kpi-grid">
              {tiles.map((tile) => (
                <Tile key={tile.key} tile={tile} present={new Set(tiles.map((x) => x.key))} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function Tile({ tile, present }: { tile: DashboardTile; present: ReadonlySet<string> }) {
  const tx = useText()
  const { number, locale } = useI18n()
  const spec = TILES[tile.key]!
  const alert = spec.backlog && tile.count > 0
  return (
    <li>
      <Link to={spec.href(present)} className={alert ? 'kpi-card dash-tile dash-tile--alert' : 'kpi-card dash-tile'}>
        <span className="kpi-card__top">
          <span className="kpi-card__icon" aria-hidden="true">
            <Icon name={spec.icon} size={18} />
          </span>
          <span className="kpi-card__label">{tx(spec.label)}</span>
          <Icon name="chevronForward" size={16} />
        </span>
        <span className="kpi-card__value">{tile.capped ? `${number(tile.count)}+` : number(tile.count)}</span>
        {tile.oldestAt && tile.count > 0 && (
          <span className="kpi-card__sub">{fill(tx(D.oldest), { age: relativeTime(tile.oldestAt, locale) })}</span>
        )}
      </Link>
    </li>
  )
}
