import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { fill, relativeTime, usePlural, useText, type Bilingual } from '@/features/admin/copy'
import { matches, useDocumentTitle } from '@/features/admin/common'
import type { StoryState, StudioStory } from './api'
import { AudienceDataPanel } from './AudienceDataPanel'
import { CHILDREN_LABEL, COUNT, CTA_LABEL, KIND_LABEL, PLAN_LABEL, S, STATE_LABEL, useCountryName } from './copy'
import { useCanManageAudienceData, usePublishStory, useStudioStories } from './hooks'
import { StoryPreview } from './StoryPreview'
import './stories.css'

const STATE_TONE: Record<string, Tone> = { published: 'ok', draft: 'neutral', expired: 'outline', deleted: 'danger' }
const STATES: readonly StoryState[] = ['published', 'draft', 'expired', 'deleted']

type SortKey = 'newest' | 'oldest' | 'views' | 'reach' | 'taps'
const SORTS: readonly SortKey[] = ['newest', 'oldest', 'views', 'reach', 'taps']

const SORT_LABEL: Record<SortKey, Bilingual> = {
  newest: { en: 'Newest', ar: 'الأحدث' },
  oldest: { en: 'Oldest', ar: 'الأقدم' },
  views: { en: 'Most viewed', ar: 'الأكثر مشاهدة' },
  reach: { en: 'Largest audience', ar: 'الجمهور الأكبر' },
  taps: { en: 'Most taps', ar: 'الأكثر نقرًا' },
}

/**
 * What a reader experiences. A pre-2026-10-17 story whose expiry has passed is
 * hidden from its audience even while its stored state still says
 * `published`, so it is shown -- and filtered -- as ended. A story published
 * since then has no expiry and is live until deleted.
 */
export function effectiveState(s: Pick<StudioStory, 'state' | 'expiresAt'>, now = Date.now()): StoryState {
  if (s.state === 'published' && s.expiresAt && new Date(s.expiresAt).getTime() <= now) return 'expired'
  return s.state
}

/** Share of the audience that viewed it; null before it reached anybody. */
export function viewRate(s: Pick<StudioStory, 'recipientCount' | 'viewCount'>): number | null {
  return s.recipientCount > 0 ? Math.min(1, s.viewCount / s.recipientCount) : null
}

/** "Parents & students · UAE, Kuwait · 6 months" -- the audience in words. */
export function useAudienceSummary() {
  const tx = useText()
  const { locale } = useI18n()
  const countryName = useCountryName()
  const sep = locale === 'ar' ? '، ' : ', '
  return (story: Pick<StudioStory, 'audiences'>): string => {
    const parts = story.audiences.map((a) => {
      if (a.kind === 'segment' && a.filter) {
        const f = a.filter
        if (f.who === 'everyone') return tx(S.whoEveryone)
        if (f.who === 'teachers') return tx(S.whoTeachers)
        const bits = [tx(S.whoFamilies)]
        if (f.countries?.length) bits.push(f.countries.map(countryName).join(sep))
        if (f.planMonths?.length) bits.push(f.planMonths.map((m) => tx(PLAN_LABEL[m] ?? { en: `${m}`, ar: `${m}` })).join(sep))
        if (f.children?.length) bits.push(f.children.map((c) => tx(CHILDREN_LABEL[c] ?? { en: `${c}`, ar: `${c}` })).join(sep))
        return bits.join(' · ')
      }
      return tx(LEGACY_AUDIENCE[a.kind] ?? { en: a.kind, ar: a.kind })
    })
    return parts.join(' + ')
  }
}

const LEGACY_AUDIENCE: Record<string, Bilingual> = {
  all_families: { en: 'All families', ar: 'كل العائلات' },
  all_teachers: { en: 'All teachers', ar: 'كل المعلمين' },
  assigned_families: { en: 'Supervised families', ar: 'العائلات المُشرَف عليها' },
  family: { en: 'One family', ar: 'عائلة واحدة' },
  teacher: { en: 'One teacher', ar: 'معلم واحد' },
  contact: { en: 'One parent', ar: 'ولي أمر واحد' },
  conversation: { en: 'One group', ar: 'مجموعة واحدة' },
}

/** A story's name in the list: its internal name, its legacy title, or its words. */
export function storyName(s: StudioStory, untitled: string): string {
  return s.internalName ?? s.title ?? (s.kind === 'text' && s.body ? s.body.slice(0, 60) : untitled)
}

/**
 * The Stories studio's front page: what is live, how it is doing, and the way
 * to make a new one. Shared by the Admin Portal (`/admin/stories`) and the
 * operator console (`/stories`); `basePath` is the only difference.
 *
 * The status filter, the sort and the tab live in the URL, so the dashboard
 * can link to "drafts" and a filtered view can be shared.
 */
export function StoriesStudio({ basePath, eyebrow }: { basePath: string; eyebrow?: string }) {
  const tx = useText()
  const { number } = useI18n()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const canManageData = useCanManageAudienceData()
  useDocumentTitle(tx(S.title))

  const tab = params.get('tab') === 'audience' && canManageData ? 'audience' : 'stories'
  const withParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(key)
    else next.set(key, value)
    return next
  }

  return (
    <div className="page stories-studio">
      <div className="page__inner">
        <PageHeader
          eyebrow={eyebrow}
          title={tx(S.title)}
          subtitle={tx(S.subtitle)}
          actions={
            <Link to={`${basePath}/new`} className="btn btn--primary">
              <Icon name="plus" size={16} />
              {tx(S.newStory)}
            </Link>
          }
        />

        {canManageData && (
          <nav className="studio-tabs" aria-label={tx(S.title)}>
            <Link
              to={{ search: withParam('tab', null).toString() }}
              replace
              className="studio-tab"
              aria-current={tab === 'stories' ? 'page' : undefined}
            >
              {tx(S.tabStories)}
            </Link>
            <Link
              to={{ search: withParam('tab', 'audience').toString() }}
              replace
              className="studio-tab"
              aria-current={tab === 'audience' ? 'page' : undefined}
            >
              {tx(S.tabAudience)}
            </Link>
          </nav>
        )}

        {tab === 'audience' ? (
          <AudienceDataPanel />
        ) : (
          <StoryList
            basePath={basePath}
            search={search}
            setSearch={setSearch}
            params={params}
            setParams={setParams}
            withParam={withParam}
            number={number}
          />
        )}
      </div>
    </div>
  )
}

function StoryList({
  basePath,
  search,
  setSearch,
  params,
  setParams,
  withParam,
  number,
}: {
  basePath: string
  search: string
  setSearch: (v: string) => void
  params: URLSearchParams
  setParams: ReturnType<typeof useSearchParams>[1]
  withParam: (key: string, value: string | null) => URLSearchParams
  number: (n: number) => string
}) {
  const tx = useText()
  const label = (s: StoryState) => tx(STATE_LABEL[s])
  const query = useStudioStories()
  const summary = useAudienceSummary()
  const now = Date.now()

  const stories = query.stories
  const stateFilter = params.get('state') ?? 'all'
  const sortParam = params.get('sort') as SortKey | null
  const sort: SortKey = sortParam && SORTS.includes(sortParam) ? sortParam : 'newest'

  const searched = useMemo(
    () =>
      stories.filter(
        (s) =>
          matches(storyName(s, ''), search) ||
          matches(s.creatorName, search) ||
          matches(s.body, search) ||
          matches(summary(s), search),
      ),
    // summary is a fresh closure each render but depends only on the locale
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stories, search],
  )
  const counts: Record<string, number> = {}
  for (const s of searched) counts[effectiveState(s, now)] = (counts[effectiveState(s, now)] ?? 0) + 1
  const visible = searched.filter((s) => stateFilter === 'all' || effectiveState(s, now) === stateFilter)
  if (sort === 'oldest') visible.reverse()
  else if (sort === 'views') visible.sort((a, b) => b.viewCount - a.viewCount)
  else if (sort === 'reach') visible.sort((a, b) => b.recipientCount - a.recipientCount)
  else if (sort === 'taps') visible.sort((a, b) => b.ctaTapCount - a.ctaTapCount)

  const counted = stories.filter((s) => s.state !== 'deleted')
  const kpis = [
    { key: 'live', label: tx(S.liveNow), value: stories.filter((s) => effectiveState(s, now) === 'published').length },
    { key: 'reach', label: tx(S.totalReach), value: counted.reduce((n, s) => n + s.recipientCount, 0) },
    { key: 'views', label: tx(S.totalViews), value: counted.reduce((n, s) => n + s.viewCount, 0) },
    { key: 'taps', label: tx(S.totalTaps), value: counted.reduce((n, s) => n + s.ctaTapCount, 0) },
  ]
  const tiles = [
    { key: 'all', label: tx(S.all), count: searched.length },
    ...STATES.map((s) => ({ key: s, label: label(s), count: counts[s] ?? 0 })),
  ]
  const filtered = search !== '' || stateFilter !== 'all'

  return (
    <QueryBoundary
      isLoading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={stories.length === 0}
      emptyTitle={tx(S.noStories)}
      emptyHint={
        <>
          <span>{tx(S.noStoriesHint)}</span>
          <span className="empty-action">
            <Link to={`${basePath}/new`} className="btn btn--primary">
              <Icon name="plus" size={16} />
              {tx(S.newStory)}
            </Link>
          </span>
        </>
      }
      emptyIcon="stories"
    >
      <section className="kpi-strip" aria-label={tx(S.insights)}>
        {kpis.map((k) => (
          <div key={k.key} className={`kpi kpi--${k.key}`}>
            <span className="kpi__label">{k.label}</span>
            <span className="kpi__value">{number(k.value)}</span>
          </div>
        ))}
      </section>

      <nav className="status-tiles" aria-label={tx(S.status)}>
        {tiles.map((t) => (
          <Link
            key={t.key}
            to={{ search: withParam('state', t.key === 'all' ? null : t.key).toString() }}
            replace
            className={`status-tile status-tile--${t.key === 'all' ? 'all' : t.key}`}
            aria-current={stateFilter === t.key ? 'true' : undefined}
          >
            <span className="status-tile__label">
              {t.key !== 'all' && <span className="status-tile__dot" aria-hidden="true" />}
              {t.label}
            </span>
            <span className="status-tile__count">{number(t.count)}</span>
          </Link>
        ))}
      </nav>

      <div className="toolbar">
        <SearchField value={search} onChange={setSearch} label={tx(S.searchStories)} clearLabel={tx(S.clearSearch)} />
        <div className="toolbar__end">
          <select
            className="select select--inline"
            value={sort}
            onChange={(e) => setParams(withParam('sort', e.target.value === 'newest' ? null : e.target.value), { replace: true })}
            aria-label="Sort"
          >
            {SORTS.map((k) => (
              <option key={k} value={k}>{tx(SORT_LABEL[k])}</option>
            ))}
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="table-wrap">
          <EmptyState
            compact
            icon="search"
            title={tx(S.noMatches)}
            action={
              filtered && (
                <Link className="btn btn--sm" to={{ search: withParam('state', null).toString() }} replace onClick={() => setSearch('')}>
                  {tx(S.all)}
                </Link>
              )
            }
          />
        </div>
      ) : (
        <ul className="story-rows" aria-label={tx(S.title)}>
          {visible.map((s) => (
            <StoryRow key={s.id} story={s} basePath={basePath} now={now} audience={summary(s)} />
          ))}
        </ul>
      )}
    </QueryBoundary>
  )
}

function StoryRow({ story: s, basePath, now, audience }: { story: StudioStory; basePath: string; now: number; audience: string }) {
  const tx = useText()
  const plural = usePlural()
  const { locale, number } = useI18n()
  const navigate = useNavigate()
  const publish = usePublishStory()
  const state = effectiveState(s, now)
  const rate = viewRate(s)
  const name = storyName(s, tx(S.untitled))
  const href = `${basePath}/${s.id}`
  const when = s.publishedAt
    ? fill(tx(S.publishedAgo), { when: relativeTime(s.publishedAt, locale) })
    : fill(tx(S.createdAgo), { when: relativeTime(s.createdAt, locale) })

  return (
    <li className={`story-row story-row--${state}`}>
      <Link to={href} className="story-row__thumb" tabIndex={-1} aria-hidden="true">
        <StoryPreview
          size="thumb"
          story={{
            kind: s.kind,
            body: s.kind === 'text' ? s.body : null,
            background: s.background,
            mediaUrl: s.kind === 'image' ? s.mediaUrl : null,
            mediaDurationMs: s.mediaDurationMs,
            cta: null,
          }}
        />
      </Link>

      <div className="story-row__main">
        <Link to={href} className="story-row__name" dir="auto">{name}</Link>
        <span className="story-row__meta">
          <span className="story-row__kind">{tx(KIND_LABEL[s.kind])}</span>
          {s.cta && <span className="story-row__cta">· {tx(CTA_LABEL[s.cta.kind])}</span>}
          <span>· {fill(tx(S.by), { name: s.creatorName })}</span>
          <span>· {when}</span>
        </span>
        <span className="story-row__audience" title={audience}>
          <Icon name="users" size={14} />
          {audience}
        </span>
      </div>

      <div className="story-row__status">
        <Badge tone={STATE_TONE[state] ?? 'neutral'} dot>{tx(STATE_LABEL[state])}</Badge>
      </div>

      <div className="story-row__perf">
        {rate === null ? (
          <span className="cell-muted">{tx(S.notPublished)}</span>
        ) : (
          <>
            <span className="story-row__views">
              {fill(tx(S.viewedOf), { views: number(s.viewCount), reach: number(s.recipientCount) })}
            </span>
            <span className="reach__bar" aria-hidden="true">
              <span className="reach__fill" style={{ inlineSize: `${Math.round(rate * 100)}%` }} />
            </span>
            {s.cta && <span className="story-row__taps">{plural(COUNT.taps, s.ctaTapCount)}</span>}
          </>
        )}
      </div>

      <div className="story-row__actions">
        {s.state === 'draft' ? (
          <button
            type="button"
            className="btn btn--sm btn--primary"
            disabled={publish.isPending}
            onClick={() => publish.mutate(s.id, { onSuccess: () => navigate(href) })}
          >
            {tx(S.publish)}
          </button>
        ) : (
          <Link to={href} className="btn btn--sm btn--ghost" aria-label={`${tx(S.viewInsights)}: ${name}`}>
            <Icon name="chart" size={16} />
            <span className="story-row__action-text">{tx(S.viewInsights)}</span>
          </Link>
        )}
      </div>
      {publish.error && <p className="field__error story-row__error" role="alert">{(publish.error as Error).message}</p>}
    </li>
  )
}
