import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { PageHeader, type MastFigure } from '@/shared/components/PageHeader'
import { RowActions } from '@/shared/components/RowActions'
import type { MenuItem } from '@/shared/components/Menu'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { fill, relativeTime, usePlural, useText, type Bilingual } from '@/features/admin/copy'
import { matches, useDocumentTitle } from '@/features/admin/common'
import type { StoryState, StudioStory } from './api'
import { AudienceDataPanel } from './AudienceDataPanel'
import { CHILDREN_LABEL, COUNT, CTA_LABEL, KIND_LABEL, PLAN_LABEL, S, STATE_LABEL, useCountryName } from './copy'
import { useCanManageAudienceData, usePublishStory, useStudioStories } from './hooks'
import { DeleteDialog } from './StoryInsights'
import { StoryPreview } from './StoryPreview'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
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

/** "Parents & students; UAE, Kuwait; 6 months" -- the audience in words. */
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
        return bits.join(locale === 'ar' ? '؛ ' : '; ')
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

const WEEK_MS = 7 * 86_400_000

/**
 * The Stories studio's front page. Shared by the Admin Portal
 * (`/admin/stories`) and the operator console (`/stories`); `basePath` is the
 * only difference.
 *
 * A studio: the masthead says how many are live, how many are drafts and how
 * far they reached, and carries the states as its tabs; the body is a grid of
 * story sheets, each led by the story's own face, because a story is a picture.
 *
 * The status filter, the sort and the tab live in the URL, so the dashboard
 * can link to "drafts" and a filtered view can be shared.
 */
export function StoriesStudio({ basePath, eyebrow }: { basePath: string; eyebrow?: string }) {
  const tx = useText()
  const { number } = useI18n()
  const plural = usePlural()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const canManageData = useCanManageAudienceData()
  const query = useStudioStories()
  useDocumentTitle(tx(S.title))
  const now = Date.now()

  const tab = params.get('tab') === 'audience' && canManageData ? 'audience' : 'stories'
  const stateFilter = params.get('state') ?? 'all'
  const withParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(key)
    else next.set(key, value)
    return next
  }
  const stateSearch = (state: string | null) => {
    const next = withParam('state', state)
    next.delete('tab')
    return next.toString()
  }

  const stories = query.stories
  const counts: Record<string, number> = {}
  for (const st of stories) counts[effectiveState(st, now)] = (counts[effectiveState(st, now)] ?? 0) + 1
  const counted = stories.filter((st) => st.state !== 'deleted')
  const reach = counted.reduce((n, st) => n + st.recipientCount, 0)
  const reachWeek = counted
    .filter((st) => st.publishedAt && now - new Date(st.publishedAt).getTime() < WEEK_MS)
    .reduce((n, st) => n + st.recipientCount, 0)
  const figures: MastFigure[] | undefined = query.isLoading || query.error
    ? undefined
    : [
        // How far the stories went; how many are live or drafts is said by the tabs below.
        { key: 'reach', label: tx(S.totalReach), value: number(reach), tone: 'key', note: fill(tx(S.reachWeek), { n: number(reachWeek) }) },
        {
          key: 'views',
          label: tx(S.totalViews),
          value: number(counted.reduce((n, st) => n + st.viewCount, 0)),
          note: plural(COUNT.taps, counted.reduce((n, st) => n + st.ctaTapCount, 0)),
        },
      ]
  const tabs = [
    { key: 'all', label: tx(S.all), count: stories.length },
    ...STATES.map((st) => ({ key: st as string, label: tx(STATE_LABEL[st]), count: counts[st] ?? 0 })),
  ]

  return (
    <div className="page stories-studio">
      <div className="page__inner">
        <PageHeader
          eyebrow={eyebrow}
          title={tx(S.title)}
          figures={figures}
          actions={
            <Link to={`${basePath}/new`} className="btn btn--primary">
              <Icon name="plus" size={16} />
              {tx(S.newStory)}
            </Link>
          }
          tabs={
            <nav className="seg studio-tabs" aria-label={tx(S.status)}>
              {tabs.map((t) => (
                <Link
                  key={t.key}
                  to={{ search: stateSearch(t.key === 'all' ? null : t.key) }}
                  replace
                  className="seg__item studio-tab"
                  aria-current={tab === 'stories' && stateFilter === t.key ? 'true' : undefined}
                >
                  {t.label}
                  <span className="seg__count">{number(t.count)}</span>
                </Link>
              ))}
              {canManageData && (
                <Link
                  to={{ search: withParam('tab', 'audience').toString() }}
                  replace
                  className="seg__item studio-tab studio-tab--data"
                  aria-current={tab === 'audience' ? 'page' : undefined}
                >
                  {tx(S.tabAudience)}
                </Link>
              )}
            </nav>
          }
        />

        {tab === 'audience' ? (
          <AudienceDataPanel />
        ) : (
          <StoryList basePath={basePath} search={search} setSearch={setSearch} params={params} setParams={setParams} withParam={withParam} />
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
}: {
  basePath: string
  search: string
  setSearch: (v: string) => void
  params: URLSearchParams
  setParams: ReturnType<typeof useSearchParams>[1]
  withParam: (key: string, value: string | null) => URLSearchParams
}) {
  const tx = useText()
  const query = useStudioStories()
  const summary = useAudienceSummary()
  const [deleting, setDeleting] = useState<string | null>(null)
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
  const visible = searched.filter((s) => stateFilter === 'all' || effectiveState(s, now) === stateFilter)
  if (sort === 'oldest') visible.reverse()
  else if (sort === 'views') visible.sort((a, b) => b.viewCount - a.viewCount)
  else if (sort === 'reach') visible.sort((a, b) => b.recipientCount - a.recipientCount)
  else if (sort === 'taps') visible.sort((a, b) => b.ctaTapCount - a.ctaTapCount)
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
            <Link to={`${basePath}/new`} className="btn btn--sm">
              <Icon name="plus" size={16} />
              {tx(S.newStory)}
            </Link>
          </span>
        </>
      }
    >
      <div className="story-board">
        <div className="sheet sheet-bar story-board__bar">
          <SearchField value={search} onChange={setSearch} label={tx(S.searchStories)} clearLabel={tx(S.clearSearch)} />
          <div className="sheet-bar__end">
            <SearchableSelect
              className="select select--inline"
              value={sort}
              onValueChange={(v) => setParams(withParam('sort', v === 'newest' ? null : v), { replace: true })}
              aria-label="Sort"
            >
              {SORTS.map((k) => (
                <option key={k} value={k}>{tx(SORT_LABEL[k])}</option>
              ))}
            </SearchableSelect>
          </div>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            compact
            title={tx(S.noMatches)}
            action={
              filtered && (
                <Link className="btn btn--sm" to={{ search: withParam('state', null).toString() }} replace onClick={() => setSearch('')}>
                  {tx(S.all)}
                </Link>
              )
            }
          />
        ) : (
          <ul className="story-grid" aria-label={tx(S.title)}>
            {visible.map((s) => (
              <StoryCard key={s.id} story={s} basePath={basePath} now={now} audience={summary(s)} onDelete={() => setDeleting(s.id)} />
            ))}
          </ul>
        )}
      </div>
      {deleting && <DeleteDialog storyId={deleting} onClose={() => setDeleting(null)} onDeleted={() => setDeleting(null)} />}
    </QueryBoundary>
  )
}

/** One story as a sheet: its own face first, then what it is, who it is for and how it did. */
function StoryCard({
  story: s,
  basePath,
  now,
  audience,
  onDelete,
}: {
  story: StudioStory
  basePath: string
  now: number
  audience: string
  onDelete: () => void
}) {
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
  const more: MenuItem[] = [
    ...(s.state === 'draft' ? [{ key: 'open', label: tx(S.viewInsights), icon: 'chart' as const, onSelect: () => navigate(href) }] : []),
    ...(s.state !== 'deleted' ? [{ key: 'delete', label: tx(S.delete), icon: 'trash' as const, danger: true, onSelect: onDelete }] : []),
  ]

  return (
    <li className={`story-card story-card--${state}`}>
      <Link to={href} className="story-card__thumb" tabIndex={-1} aria-hidden="true">
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

      <div className="story-card__body">
        <div className="story-card__top">
          <Badge tone={STATE_TONE[state] ?? 'neutral'} dot>{tx(STATE_LABEL[state])}</Badge>
          <span className="story-row__kind">{tx(KIND_LABEL[s.kind])}</span>
          {s.cta && <span className="story-row__cta">{tx(CTA_LABEL[s.cta.kind])}</span>}
        </div>
        <Link to={href} className="story-row__name" dir="auto">{name}</Link>
        <span className="story-row__audience" title={audience}>
          <Icon name="users" size={14} />
          <span>{audience}</span>
        </span>
        <span className="story-row__meta">
          <span>{fill(tx(S.by), { name: s.creatorName })}</span>
          <span>{when}</span>
        </span>

        <div className="story-row__perf">
          {rate === null ? (
            <span className="cell-muted">{tx(S.notPublished)}</span>
          ) : (
            <>
              <span className="story-row__views">
                {fill(tx(S.viewedOf), { views: number(s.viewCount), reach: number(s.recipientCount) })}
                {s.cta && <span className="story-row__taps">{plural(COUNT.taps, s.ctaTapCount)}</span>}
              </span>
              <span className="reach__bar" aria-hidden="true">
                <span className="reach__fill" style={{ inlineSize: `${Math.round(rate * 100)}%` }} />
              </span>
            </>
          )}
        </div>

        <div className="story-card__actions">
          <RowActions
            label={fill(tx(S.moreActions), { name })}
            primary={
              s.state === 'draft' ? (
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={publish.isPending}
                  onClick={() => publish.mutate(s.id, { onSuccess: () => navigate(href) })}
                >
                  <Icon name="send" size={16} />
                  {tx(S.publish)}
                </button>
              ) : (
                <Link to={href} className="btn btn--sm" aria-label={`${tx(S.viewInsights)}: ${name}`} title={tx(S.viewInsights)}>
                  <Icon name="chart" size={16} />
                  {tx(S.insights)}
                </Link>
              )
            }
            more={more}
          />
        </div>
        {publish.error && <p className="field__error story-row__error" role="alert">{(publish.error as Error).message}</p>}
      </div>
    </li>
  )
}
