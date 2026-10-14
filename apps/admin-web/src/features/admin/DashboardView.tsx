import { Link } from 'react-router-dom'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { adminApi, type AdminConversation, type AdminOverview } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Icon, type IconName } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { Skeleton } from '@/shared/components/Skeleton'
import { EmptyState, ErrorState } from '@/shared/components/States'
import { ConversationStateBadge, RefreshAction, conversationName, useEyebrow, useRoleLabel } from './common'
import {
  ACCOUNT_KIND,
  CONVERSATION_STATE,
  CONVERSATION_TYPE,
  PLURAL,
  STORY_STATE,
  TEXT,
  fill,
  listTime,
  relativeTime,
  useLabel,
  usePlural,
  useText,
} from './copy'
import { adminSectionPath, type AdminSection } from './sections'

const RECENT = 8
const STATE_ORDER = ['waiting_on_jawwid', 'waiting_on_customer', 'open', 'resolved'] as const
const STORY_ORDER = ['published', 'draft', 'expired', 'deleted'] as const

type ConversationsQuery = UseQueryResult<{ conversations: AdminConversation[]; truncated: boolean }>

/**
 * Three questions, in this order: what needs attention (only real, non-zero
 * signals), what is happening (four linked counts), and where activity is
 * (recent conversations and how the loaded conversations divide by status).
 *
 * Every figure is read from GET /admin/overview or GET /admin/conversations.
 * Nothing is derived that the data does not support: there is no response
 * time, no assignment, no unread count and no trend, because no endpoint
 * measures one.
 */
export function DashboardView({ section }: { section: AdminSection }) {
  const tx = useText()
  const eyebrow = useEyebrow(section)
  const { t, time } = useI18n()
  const overview = useQuery({ queryKey: qk.adminOverview, queryFn: adminApi.overview })
  const conversations = useQuery({ queryKey: qk.adminConversations, queryFn: adminApi.conversations })
  const o = overview.data

  const refresh = () => {
    void overview.refetch()
    void conversations.refetch()
  }

  return (
    <div className="page dash">
      <div className="page__inner">
        <PageHeader
          eyebrow={eyebrow}
          title={tx(section.label)}
          subtitle={o?.organization.displayName}
          actions={
            <RefreshAction
              updatedAt={overview.dataUpdatedAt}
              fetching={overview.isFetching || conversations.isFetching}
              onRefresh={refresh}
            />
          }
        />

        {/* Figures kept from an earlier read are shown only with this warning,
            never silently as current. */}
        {o && overview.error && (
          <div className="stale-banner" role="status">
            <Icon name="alert" size={16} />
            <span>{fill(tx(TEXT.staleData), { time: time(new Date(overview.dataUpdatedAt).toISOString()) })}</span>
            <button type="button" className="btn btn--sm" onClick={refresh}>
              {t('common.retry')}
            </button>
          </div>
        )}

        {overview.isLoading ? (
          <DashboardSkeleton />
        ) : !o ? (
          <ErrorState error={overview.error} onRetry={refresh} />
        ) : (
          <>
            <Attention o={o} query={conversations} />
            <Kpis o={o} />
            <div className="dash-main">
              <RecentActivity query={conversations} />
              <div className="dash-side">
                <StatusBreakdown query={conversations} />
                <StoriesSummary o={o} />
                <TeamAccess o={o} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0)
}

function DashboardSkeleton() {
  const { t } = useI18n()
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{t('common.loading')}</span>
      <div className="attn attn--loading">
        <Skeleton width="30%" height={18} />
        <div className="attn__tiles">
          <Skeleton height={92} radius={12} />
          <Skeleton height={92} radius={12} />
        </div>
      </div>
      <div className="kpi-grid">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={118} radius={12} />
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- attention */

function Attention({ o, query }: { o: AdminOverview; query: ConversationsQuery }) {
  const tx = useText()
  const { number, locale } = useI18n()
  const list = query.data?.conversations ?? []
  const waitingRows = list.filter((c) => c.state === 'waiting_on_jawwid')
  const waiting = waitingRows.length
  // The list is capped at 200, so a count taken from a truncated list is a
  // lower bound and says so ("200+"), never a total.
  const waitingLabel = query.data?.truncated && waiting > 0 ? `${number(waiting)}+` : number(waiting)
  const oldest = waitingRows.reduce<string | null>(
    (min, c) => (min === null || c.lastActivityAt < min ? c.lastActivityAt : min),
    null,
  )
  const drafts = o.storiesByState.draft ?? 0

  const items = [
    waiting > 0 && {
      key: 'waiting',
      icon: 'conversations' as IconName,
      text: tx(TEXT.waitingOnUsItem),
      count: waitingLabel,
      meta: oldest ? fill(tx(TEXT.oldestWaiting), { age: relativeTime(oldest, locale) }) : null,
      cta: tx(TEXT.openQueue),
      to: `${adminSectionPath('conversations')}?state=waiting_on_jawwid`,
    },
    drafts > 0 && {
      key: 'drafts',
      icon: 'stories' as IconName,
      text: tx(TEXT.draftStoriesItem),
      count: number(drafts),
      meta: tx(TEXT.notYetPublished),
      cta: tx(TEXT.reviewDrafts),
      to: `${adminSectionPath('stories')}?state=draft`,
    },
  ].filter((x): x is Exclude<typeof x, false> => Boolean(x))

  const clear = !query.isLoading && !query.error && items.length === 0

  return (
    <section className={clear ? 'attn attn--clear' : 'attn'} aria-labelledby="dash-attention">
      <div className="attn__head">
        <span className="attn__icon" aria-hidden="true">
          <Icon name={clear ? 'check' : 'alert'} size={18} />
        </span>
        <h2 className="attn__title" id="dash-attention">
          {tx(TEXT.needsAttention)}
        </h2>
      </div>
      {query.isLoading ? (
        <div className="attn__tiles" aria-hidden="true">
          <Skeleton height={92} radius={12} />
          <Skeleton height={92} radius={12} />
        </div>
      ) : query.error ? (
        // A failed read is a failure, never "all clear" -- and counts kept from
        // an earlier read are hidden rather than presented as current.
        <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <p className="attn__clear">{tx(TEXT.nothingNeedsAttention)}</p>
      ) : (
        <ul className="attn__tiles">
          {items.map((item) => (
            <li key={item.key}>
              <Link to={item.to} className="attn-tile">
                <span className="attn-tile__icon" aria-hidden="true">
                  <Icon name={item.icon} size={20} />
                </span>
                <span className="attn-tile__body">
                  <span className="attn-tile__count">{item.count}</span>
                  <span className="attn-tile__label">{item.text}</span>
                  {item.meta && <span className="attn-tile__meta">{item.meta}</span>}
                </span>
                <span className="attn-tile__cta">
                  {item.cta}
                  <Icon name="chevronForward" size={16} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ KPIs */

function Kpis({ o }: { o: AdminOverview }) {
  const tx = useText()
  const label = useLabel()
  const plural = usePlural()
  const { number } = useI18n()
  const staff = sum(o.staffByRole)
  const direct = o.conversationsByType.direct ?? 0
  const groups = sum(o.conversationsByType) - direct
  const items: { key: string; icon: IconName; label: string; value: number; sub?: string; to: string }[] = [
    {
      key: 'families',
      icon: 'home',
      label: tx(TEXT.families),
      value: o.families,
      sub: plural(PLURAL.contacts, o.contacts),
      to: `${adminSectionPath('users')}?kind=contact`,
    },
    {
      key: 'conversations',
      icon: 'conversations',
      label: tx(TEXT.conversations),
      value: sum(o.conversationsByType),
      sub: `${label(CONVERSATION_TYPE, 'direct')} ${number(direct)} · ${tx(TEXT.groupConversations)} ${number(groups)}`,
      to: adminSectionPath('conversations'),
    },
    { key: 'messages', icon: 'messages', label: tx(TEXT.messages), value: o.messages, to: adminSectionPath('conversations') },
    {
      key: 'people',
      icon: 'users',
      label: tx(TEXT.people),
      value: staff + o.teachers + o.contacts,
      sub: `${plural(PLURAL.staff, staff)} · ${plural(PLURAL.teachers, o.teachers)}`,
      to: adminSectionPath('users'),
    },
  ]
  return (
    <ul className="kpi-grid">
      {items.map((k) => (
        <li key={k.key}>
          <Link to={k.to} className="kpi-card">
            <span className="kpi-card__top">
              <span className="kpi-card__icon" aria-hidden="true">
                <Icon name={k.icon} size={18} />
              </span>
              <span className="kpi-card__label">{k.label}</span>
              <Icon name="chevronForward" size={16} />
            </span>
            <span className="kpi-card__value">{number(k.value)}</span>
            {k.sub && <span className="kpi-card__sub">{k.sub}</span>}
          </Link>
        </li>
      ))}
    </ul>
  )
}

/* ---------------------------------------------------------- recent table */

function RecentActivity({ query }: { query: ConversationsQuery }) {
  const tx = useText()
  const label = useLabel()
  const plural = usePlural()
  const { locale, dateTime } = useI18n()
  const list = (query.data?.conversations ?? []).slice(0, RECENT)

  return (
    <section className="card card--flush dash-card" aria-labelledby="dash-recent">
      <div className="card__header">
        <h2 className="card__title" id="dash-recent">
          {tx(TEXT.recentActivity)}
        </h2>
        {list.length > 0 && (
          <Link to={adminSectionPath('conversations')} className="card__link">
            {tx(TEXT.viewAll)}
            <Icon name="chevronForward" size={14} />
          </Link>
        )}
      </div>
      {query.isLoading ? (
        <div className="dash-card__pad" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={40} style={{ marginBlockEnd: 10 }} />
          ))}
        </div>
      ) : query.error ? (
        <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState compact icon="conversations" title={tx(TEXT.noConversations)} />
      ) : (
        <table className="table dash-table">
          <thead>
            <tr>
              <th>{tx(TEXT.conversation)}</th>
              <th className="col-optional">{tx(TEXT.status)}</th>
              <th className="num col-optional">{tx(TEXT.membersLabel)}</th>
              <th>{tx(TEXT.lastActivity)}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const name = conversationName(c, tx(TEXT.untitled))
              return (
                <tr key={c.id}>
                  <td>
                    <Link to={`${adminSectionPath('conversations')}?c=${c.id}`} className="entity entity--link">
                      <Avatar name={name} seed={c.id} size="sm" />
                      <span className="entity__text">
                        <span className="entity__name">{name}</span>
                        <span className="entity__sub">{label(CONVERSATION_TYPE, c.type)}</span>
                        {/* On a phone the status column folds in under the name. */}
                        <span className="only-narrow">
                          <ConversationStateBadge state={c.state} showOpen />
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="col-optional">
                    <ConversationStateBadge state={c.state} showOpen />
                  </td>
                  <td className="num col-optional cell-muted">{plural(PLURAL.members, c.liveMembers)}</td>
                  <td className="cell-muted cell-nowrap">
                    <time dateTime={c.lastActivityAt} title={dateTime(c.lastActivityAt)}>
                      {listTime(c.lastActivityAt, locale)}
                    </time>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

/* ------------------------------------------------------------ side cards */

function DistRows({
  rows,
  total,
}: {
  rows: { key: string; label: string; value: number; to: string; tone: string }[]
  total: number
}) {
  const { number } = useI18n()
  return (
    <ul className="dist">
      {rows.map((r) => (
        <li key={r.key}>
          <Link to={r.to} className="dist__row">
            <span className="dist__label">
              <span className={`dist__dot dist__dot--${r.tone}`} aria-hidden="true" />
              {r.label}
            </span>
            <span className="dist__value">{number(r.value)}</span>
            <span className="dist__bar" aria-hidden="true">
              <span
                className={`dist__fill dist__fill--${r.tone}`}
                style={{ inlineSize: total > 0 && r.value > 0 ? `${Math.max(2, (100 * r.value) / total)}%` : 0 }}
              />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

const STATE_TONE: Record<string, string> = {
  waiting_on_jawwid: 'warn',
  waiting_on_customer: 'info',
  open: 'neutral',
  resolved: 'ok',
}

function StatusBreakdown({ query }: { query: ConversationsQuery }) {
  const tx = useText()
  const label = useLabel()
  const { number } = useI18n()
  const list = query.data?.conversations ?? []
  const counts: Record<string, number> = {}
  for (const c of list) counts[c.state] = (counts[c.state] ?? 0) + 1
  const rows = STATE_ORDER.map((s) => ({
    key: s,
    label: label(CONVERSATION_STATE, s),
    value: counts[s] ?? 0,
    to: `${adminSectionPath('conversations')}?state=${s}`,
    tone: STATE_TONE[s] ?? 'neutral',
  }))
  return (
    <section className="card dash-card" aria-labelledby="dash-status">
      <h2 className="card__title card__title--sm" id="dash-status">
        {tx(TEXT.conversationStatus)}
      </h2>
      {query.isLoading ? (
        <Skeleton height={120} />
      ) : query.error ? (
        <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <DistRows rows={rows} total={list.length} />
          {query.data?.truncated && (
            <p className="list-footnote">{fill(tx(TEXT.basedOnRecent), { n: number(list.length) })}</p>
          )}
        </>
      )}
    </section>
  )
}

const STORY_TONE: Record<string, string> = { published: 'ok', draft: 'neutral', expired: 'muted', deleted: 'danger' }

function StoriesSummary({ o }: { o: AdminOverview }) {
  const tx = useText()
  const label = useLabel()
  const rows = STORY_ORDER.map((s) => ({
    key: s,
    label: label(STORY_STATE, s),
    value: o.storiesByState[s] ?? 0,
    to: `${adminSectionPath('stories')}?state=${s}`,
    tone: STORY_TONE[s] ?? 'neutral',
  }))
  return (
    <section className="card dash-card" aria-labelledby="dash-stories">
      <div className="card__header card__header--tight">
        <h2 className="card__title card__title--sm" id="dash-stories">
          {tx(TEXT.storiesByState)}
        </h2>
        <Link to={adminSectionPath('stories')} className="card__link">
          {tx(TEXT.viewAll)}
          <Icon name="chevronForward" size={14} />
        </Link>
      </div>
      <DistRows rows={rows} total={sum(o.storiesByState)} />
    </section>
  )
}

function TeamAccess({ o }: { o: AdminOverview }) {
  const tx = useText()
  const label = useLabel()
  const roleLabel = useRoleLabel()
  const { number } = useI18n()
  const roles = Object.entries(o.staffByRole).sort((a, b) => b[1] - a[1])
  const kinds = Object.entries(o.accounts)
  return (
    <section className="card dash-card" aria-labelledby="dash-team">
      <h2 className="card__title card__title--sm" id="dash-team">
        {tx(TEXT.teamAndAccess)}
      </h2>
      {roles.length === 0 && kinds.length === 0 ? (
        <p className="breakdown__empty">{tx(TEXT.none)}</p>
      ) : (
        <>
          {roles.length > 0 && (
            <ul className="role-pills" aria-label={tx(TEXT.staffByRole)}>
              {roles.map(([role, n]) => (
                <li className="role-pill" key={role}>
                  {roleLabel(role) ?? role}
                  <span className="role-pill__n">{number(n)}</span>
                </li>
              ))}
            </ul>
          )}
          {kinds.length > 0 && (
            // Two cells, never "a / b": in RTL the bidi algorithm reverses the
            // pair, and "0 / 6" reads as six inactive logins.
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>{tx(TEXT.signIns)}</th>
                  <th className="num">{tx(TEXT.active)}</th>
                  <th className="num">{tx(TEXT.inactive)}</th>
                </tr>
              </thead>
              <tbody>
                {kinds.map(([kind, v]) => (
                  <tr key={kind}>
                    <td>{label(ACCOUNT_KIND, kind)}</td>
                    <td className="num">{number(v.active)}</td>
                    <td className="num">{number(v.inactive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  )
}
