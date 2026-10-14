import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { adminApi, type AdminStory } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Dialog } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { RefreshAction, matches, useEyebrow } from './common'
import { PLURAL, STORY_STATE, TEXT, dayMonth, fill, relativeTime, useLabel, usePlural, useText } from './copy'
import type { AdminSection } from './sections'

const STATE_TONE: Record<string, Tone> = {
  published: 'ok',
  draft: 'neutral',
  expired: 'outline',
  deleted: 'danger',
}
const STATES = ['published', 'draft', 'expired', 'deleted'] as const

type SortKey = 'newest' | 'oldest' | 'views' | 'audience'
const SORTS: readonly SortKey[] = ['newest', 'oldest', 'views', 'audience']

/**
 * What a viewer actually experiences. Expiry is an access rule: a story whose
 * `expires_at` has passed is hidden from every audience even while its stored
 * state still says `published`, so it is shown -- and filtered -- as expired.
 */
export function effectiveState(s: AdminStory, now: number = Date.now()): string {
  if (s.state === 'published' && s.expiresAt && new Date(s.expiresAt).getTime() <= now) return 'expired'
  return s.state
}

/** Share of the audience that has viewed it; null when there was no audience. */
export function viewRate(s: AdminStory): number | null {
  return s.recipients > 0 ? Math.min(1, s.views / s.recipients) : null
}

/**
 * Every story in the organization, read-only. There is no create, publish or
 * delete control here: the server refuses those to this account, and a button
 * that could only fail would be a lie.
 *
 * The status filter and the sort live in the URL (`?state=`, `?sort=`), so the
 * dashboard can link to "drafts" and a filtered view can be shared.
 */
export function StoriesView({ section }: { section: AdminSection }) {
  const tx = useText()
  const eyebrow = useEyebrow(section)
  const label = useLabel()
  const plural = usePlural()
  const { number } = useI18n()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now)

  const query = useQuery({ queryKey: qk.adminStories, queryFn: adminApi.stories })
  const stories = useMemo(() => query.data?.stories ?? [], [query.data])
  // Re-evaluate expiry whenever the data is re-read.
  useEffect(() => setNow(Date.now()), [query.dataUpdatedAt])

  const stateFilter = params.get('state') ?? 'all'
  const sortParam = params.get('sort')
  const sort: SortKey = SORTS.includes(sortParam as SortKey) ? (sortParam as SortKey) : 'newest'
  const withParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(key)
    else next.set(key, value)
    return next
  }

  const searched = stories.filter((s) => matches(s.title, search) || matches(s.creatorName, search))
  const counts: Record<string, number> = {}
  for (const s of searched) counts[effectiveState(s, now)] = (counts[effectiveState(s, now)] ?? 0) + 1
  const visible = searched.filter((s) => stateFilter === 'all' || effectiveState(s, now) === stateFilter)
  // The API returns newest-first; the other orders are views of it.
  if (sort === 'oldest') visible.reverse()
  else if (sort === 'views') visible.sort((a, b) => b.views - a.views)
  else if (sort === 'audience') visible.sort((a, b) => b.recipients - a.recipients)

  const open = stories.find((s) => s.id === openId) ?? null
  const filtered = search !== '' || stateFilter !== 'all'
  const publisher = section.legacy?.[0]

  const tiles = [
    { key: 'all', label: tx(TEXT.all), count: searched.length, tone: 'all' },
    ...STATES.map((s) => ({ key: s, label: label(STORY_STATE, s), count: counts[s] ?? 0, tone: s })),
  ]

  return (
    <div className="page stories">
      <div className="page__inner">
        <PageHeader
          eyebrow={eyebrow}
          title={tx(section.label)}
          subtitle={query.data ? plural(PLURAL.stories, stories.length) : undefined}
          actions={
            <RefreshAction
              updatedAt={query.dataUpdatedAt}
              fetching={query.isFetching}
              onRefresh={() => void query.refetch()}
            />
          }
        />

        {publisher?.note && (
          <div className="readonly-note" role="note">
            <span className="readonly-note__icon" aria-hidden="true">
              <Icon name="lock" size={16} />
            </span>
            <span>
              <strong>{tx(TEXT.publishingUnavailable)}</strong> {tx(publisher.note)}
            </span>
          </div>
        )}

        <QueryBoundary
          isLoading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          isEmpty={stories.length === 0}
          emptyTitle={tx(TEXT.noStories)}
          emptyHint={tx(TEXT.noStoriesHint)}
          emptyIcon="stories"
        >
          {/* Status tiles are links: a filtered view is an address you can share. */}
          <nav className="status-tiles" aria-label={tx(TEXT.status)}>
            {tiles.map((t) => {
              const active = stateFilter === t.key
              return (
                <Link
                  key={t.key}
                  to={{ search: withParam('state', t.key === 'all' ? null : t.key).toString() }}
                  replace
                  className={`status-tile status-tile--${t.tone}`}
                  aria-current={active ? 'true' : undefined}
                >
                  <span className="status-tile__label">
                    {t.key !== 'all' && <span className="status-tile__dot" aria-hidden="true" />}
                    {t.label}
                  </span>
                  <span className="status-tile__count">{number(t.count)}</span>
                </Link>
              )
            })}
          </nav>

          <div className="toolbar">
            <SearchField
              value={search}
              onChange={setSearch}
              label={tx(TEXT.searchStories)}
              clearLabel={tx(TEXT.clearSearch)}
            />
            <div className="toolbar__end">
              <span className="toolbar__count">{fill(tx(TEXT.results), { n: number(visible.length) })}</span>
              <select
                className="select select--inline"
                value={sort}
                onChange={(e) =>
                  setParams(withParam('sort', e.target.value === 'newest' ? null : e.target.value), { replace: true })
                }
                aria-label={tx(TEXT.sortBy)}
              >
                <option value="newest">{tx(TEXT.sortNewest)}</option>
                <option value="oldest">{tx(TEXT.sortOldest)}</option>
                <option value="views">{tx(TEXT.sortMostViewed)}</option>
                <option value="audience">{tx(TEXT.sortAudience)}</option>
              </select>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="table-wrap">
              <EmptyState
                compact
                icon="search"
                title={tx(TEXT.noMatches)}
                action={
                  filtered && (
                    <Link
                      className="btn btn--sm"
                      to={{ search: withParam('state', null).toString() }}
                      replace
                      onClick={() => setSearch('')}
                    >
                      {tx(TEXT.clearFilters)}
                    </Link>
                  )
                }
              />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table table--interactive story-table">
                <thead>
                  <tr>
                    <th>{tx(TEXT.story)}</th>
                    <th>{tx(TEXT.status)}</th>
                    <th className="col-optional">{tx(TEXT.reach)}</th>
                    <th className="col-optional">{tx(TEXT.expires)}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => (
                    <StoryRow key={s.id} s={s} now={now} onOpen={() => setOpenId(s.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {query.data?.truncated && <p className="list-footnote">{tx(TEXT.truncated)}</p>}
        </QueryBoundary>
      </div>

      {open && <StorySheet story={open} now={now} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function StoryBadge({ state }: { state: string }) {
  const label = useLabel()
  return (
    <Badge tone={STATE_TONE[state] ?? 'neutral'} dot>
      {label(STORY_STATE, state)}
    </Badge>
  )
}

/** "Published 2 hours ago" / "Created yesterday": the moment that matters for this state. */
function useStoryMoment() {
  const tx = useText()
  const { locale } = useI18n()
  return (s: AdminStory, state: string) => {
    const nowDate = new Date()
    if (state === 'deleted' && s.deletedAt) return fill(tx(TEXT.deletedAgo), { when: relativeTime(s.deletedAt, locale, nowDate) })
    if (s.publishedAt) return fill(tx(TEXT.publishedAgo), { when: relativeTime(s.publishedAt, locale, nowDate) })
    return fill(tx(TEXT.createdAgo), { when: relativeTime(s.createdAt, locale, nowDate) })
  }
}

function useExpiry() {
  const tx = useText()
  const { locale } = useI18n()
  return (s: AdminStory, state: string): string | null => {
    if (!s.expiresAt || state === 'draft' || state === 'deleted') return null
    const when = relativeTime(s.expiresAt, locale)
    return state === 'expired' ? fill(tx(TEXT.expiredAgo), { when }) : fill(tx(TEXT.expiresIn), { when })
  }
}

function Reach({ s }: { s: AdminStory }) {
  const tx = useText()
  const { number } = useI18n()
  const rate = viewRate(s)
  if (rate === null) return <span className="cell-muted">{tx(TEXT.notPublishedYet)}</span>
  return (
    <span className="reach">
      <span className="reach__text">
        {fill(tx(TEXT.viewedOf), { views: number(s.views), recipients: number(s.recipients) })}
      </span>
      <span className="reach__bar" aria-hidden="true">
        <span className="reach__fill" style={{ inlineSize: `${Math.round(rate * 100)}%` }} />
      </span>
    </span>
  )
}

function StoryRow({ s, now, onOpen }: { s: AdminStory; now: number; onOpen: () => void }) {
  const tx = useText()
  const { locale, dateTime } = useI18n()
  const moment = useStoryMoment()
  const expiry = useExpiry()
  const state = effectiveState(s, now)
  const when = s.publishedAt ?? s.createdAt
  const { day, month } = dayMonth(when, locale)
  const title = s.title ?? tx(TEXT.untitledStory)
  const exp = expiry(s, state)
  return (
    <tr onClick={onOpen}>
      <td>
        <div className="story-cell">
          <time className={`date-tile date-tile--${state}`} dateTime={when} title={dateTime(when)}>
            <span className="date-tile__day">{day}</span>
            <span className="date-tile__month">{month}</span>
          </time>
          <span className="entity__text">
            {/* The keyboard path to the row's details. */}
            <button
              type="button"
              className="row-button entity__name"
              title={title}
              onClick={(e) => {
                e.stopPropagation()
                onOpen()
              }}
            >
              {title}
            </button>
            <span className="entity__sub">
              {s.creatorName} · {moment(s, state)}
            </span>
          </span>
        </div>
      </td>
      <td>
        <StoryBadge state={state} />
      </td>
      <td className="col-optional">
        <Reach s={s} />
      </td>
      <td className="col-optional cell-muted cell-nowrap">{exp ?? tx(TEXT.dash)}</td>
    </tr>
  )
}

function StorySheet({ story: s, now, onClose }: { story: AdminStory; now: number; onClose: () => void }) {
  const tx = useText()
  const label = useLabel()
  const { dateTime, number } = useI18n()
  const state = effectiveState(s, now)
  const rate = viewRate(s)
  const steps: { key: string; label: string; at: string; tone: string }[] = [
    { key: 'created', label: tx(TEXT.created), at: s.createdAt, tone: 'neutral' },
    ...(s.publishedAt ? [{ key: 'published', label: tx(TEXT.published), at: s.publishedAt, tone: 'ok' }] : []),
    ...(s.expiresAt
      ? [{ key: 'expires', label: state === 'expired' ? label(STORY_STATE, 'expired') : tx(TEXT.expires), at: s.expiresAt, tone: 'muted' }]
      : []),
    ...(s.deletedAt ? [{ key: 'deleted', label: tx(TEXT.deletedOn), at: s.deletedAt, tone: 'danger' }] : []),
  ]
  return (
    <Dialog variant="sheet" title={s.title ?? tx(TEXT.untitledStory)} onClose={onClose}>
      <div className="story-sheet__status">
        <StoryBadge state={state} />
        <span className="cell-muted">{s.creatorName}</span>
      </div>
      <div className="stat-row">
        <div className="stat">
          <span className="stat__label">{tx(TEXT.audience)}</span>
          <span className="stat__value">{number(s.recipients)}</span>
        </div>
        <div className="stat">
          <span className="stat__label">{tx(TEXT.views)}</span>
          <span className="stat__value">{number(s.views)}</span>
        </div>
        <div className="stat">
          <span className="stat__label">{tx(TEXT.viewRate)}</span>
          <span className="stat__value">{rate === null ? tx(TEXT.dash) : `${number(Math.round(rate * 100))}%`}</span>
        </div>
      </div>
      <h3 className="dp-section__title">{tx(TEXT.timeline)}</h3>
      <ol className="timeline">
        {steps.map((st) => (
          <li key={st.key} className={`timeline__item timeline__item--${st.tone}`}>
            <span className="timeline__label">{st.label}</span>
            <time className="timeline__time" dateTime={st.at}>
              {dateTime(st.at)}
            </time>
          </li>
        ))}
      </ol>
      <h3 className="dp-section__title">{tx(TEXT.reference)}</h3>
      <code className="mono">{s.id}</code>
    </Dialog>
  )
}
