import { Fragment, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { adminApi, type AdminConversation, type AdminMessage } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { Dialog } from '@/shared/components/Dialog'
import { FilterChips } from '@/shared/components/FilterChips'
import { Icon, type IconName } from '@/shared/components/Icon'
import { SearchField } from '@/shared/components/SearchField'
import { Splitter, useResizableWidth } from '@/shared/components/Splitter'
import { EmptyState, LoadingState, QueryBoundary } from '@/shared/components/States'
import { useMediaQuery } from '@/shared/hooks/useMediaQuery'
import { chatCopyFor, systemText } from '@/features/chat/copy'
import { ConversationStateBadge, conversationName, matches } from './common'
import {
  AUTHOR_KIND,
  CONVERSATION_STATE,
  CONVERSATION_TYPE,
  MESSAGE_TYPE,
  MODERATION,
  PLURAL,
  TEXT,
  dayGroup,
  dayLabel,
  fill,
  listTime,
  relativeTime,
  useLabel,
  usePlural,
  useText,
  type DayGroup,
} from './copy'
import type { AdminSection } from './sections'

/**
 * The inbox's views by kind. Groups gathers both group types; there is no
 * unread or favourite view, because the admin API carries neither. A type in
 * an older link (?type=student_group), or one with no view of its own, still
 * filters exactly, under its own chip.
 */
const TYPE_VIEWS = ['direct', 'groups', 'official'] as const
type TypeView = (typeof TYPE_VIEWS)[number]
const GROUP_TYPES: ReadonlySet<string> = new Set(['student_group', 'class_group', 'family_group'])
const VIEWED_TYPES: ReadonlySet<string> = new Set(['direct', 'official', ...GROUP_TYPES])

function typeMatches(type: string, view: string): boolean {
  if (view === 'all') return true
  if (view === 'groups') return GROUP_TYPES.has(type)
  return type === view
}

const MESSAGE_LIMIT = 100
const PANEL_KEY = 'jawwid.admin.conversationPanel'
const LIST_WIDTH_KEY = 'jawwid.admin.listWidth'

type SortKey = 'recent' | 'oldest' | 'name'
const SORTS: readonly SortKey[] = ['recent', 'oldest', 'name']

/** A small glyph on the avatar says what kind of conversation it is at a glance. */
const TYPE_GLYPH: Record<string, IconName | undefined> = {
  student_group: 'users',
  class_group: 'academy',
  family_group: 'users',
  official: 'notifications',
  teacher_supervision: 'teams',
  trial_group: 'calendar',
}

const GROUP_LABEL: Record<DayGroup, 'groupToday' | 'groupYesterday' | 'groupWeek' | 'groupOlder'> = {
  today: 'groupToday',
  yesterday: 'groupYesterday',
  week: 'groupWeek',
  older: 'groupOlder',
}

function readPanelPref(): boolean {
  try {
    return localStorage.getItem(PANEL_KEY) !== 'closed'
  } catch {
    return true
  }
}

/**
 * Every conversation in the organization, read-only: a list, a thread, and a
 * details panel -- the layout of a messaging app, without a composer, because
 * this account cannot reply.
 *
 * The selected conversation, the filters and the sort live in the URL (`?c=`,
 * `?state=`, `?type=`, `?sort=`), so the dashboard can link straight to one
 * and Back works.
 */
export function ConversationsView({ section }: { section: AdminSection }) {
  const tx = useText()
  const label = useLabel()
  const { number, locale } = useI18n()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const wide = useMediaQuery('(min-width: 1280px)')
  const resizable = useMediaQuery('(min-width: 1024px)')
  const listWidth = useResizableWidth(LIST_WIDTH_KEY, 360, 280, 520)
  const [panelPref, setPanelPref] = useState(readPanelPref)
  const [sheetOpen, setSheetOpen] = useState(false)

  const query = useQuery({ queryKey: qk.adminConversations, queryFn: adminApi.conversations })
  const all = useMemo(() => query.data?.conversations ?? [], [query.data])

  const selectedId = params.get('c')
  const stateFilter = params.get('state') ?? 'all'
  const typeFilter = params.get('type') ?? 'all'
  const sortParam = params.get('sort')
  const sort: SortKey = SORTS.includes(sortParam as SortKey) ? (sortParam as SortKey) : 'recent'
  const selected = all.find((c) => c.id === selectedId) ?? null

  const setParam = (key: string, value: string | null, fallback = 'all') => {
    const next = new URLSearchParams(params)
    if (value === null || value === fallback) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const untitled = tx(TEXT.untitled)
  const named = all.filter((c) => matches(conversationName(c, untitled), search))
  const searched = named.filter((c) => typeMatches(c.type, typeFilter))
  // The API returns the list newest-first; the other orders are views of it.
  const sorted = searched.filter((c) => stateFilter === 'all' || c.state === stateFilter)
  if (sort === 'oldest') sorted.reverse()
  else if (sort === 'name') {
    const collator = new Intl.Collator(locale)
    sorted.sort((a, b) => collator.compare(conversationName(a, untitled), conversationName(b, untitled)))
  }

  const stateCounts = countBy(searched, (c) => c.state)
  const stateOptions = [
    { value: 'all', label: tx(TEXT.all), count: searched.length },
    ...Object.keys(CONVERSATION_STATE)
      // A filter that would always come back empty is clutter; the active one stays.
      .filter((s) => (stateCounts[s] ?? 0) > 0 || s === stateFilter)
      .map((s) => ({ value: s, label: label(CONVERSATION_STATE, s), count: stateCounts[s] ?? 0 })),
  ]
  // Views by kind, counted within the search and the status tab.
  const inState = named.filter((c) => stateFilter === 'all' || c.state === stateFilter)
  const presentTypes = Object.keys(countBy(all, (c) => c.type))
  const otherTypes = presentTypes.filter((t) => !VIEWED_TYPES.has(t))
  if (!TYPE_VIEWS.includes(typeFilter as TypeView) && typeFilter !== 'all' && !otherTypes.includes(typeFilter)) {
    otherTypes.push(typeFilter)
  }
  const viewLabel = (v: string) => (v === 'groups' ? tx(TEXT.groups) : label(CONVERSATION_TYPE, v))
  const typeOptions = [
    { value: 'all', label: tx(TEXT.all), count: inState.length },
    ...[...TYPE_VIEWS.filter((v) => v === typeFilter || all.some((c) => typeMatches(c.type, v))), ...otherTypes].map(
      (v) => ({ value: v, label: viewLabel(v), count: inState.filter((c) => typeMatches(c.type, v)).length }),
    ),
  ]
  // "All" plus a single kind is not a choice.
  const showTypeFilter = typeOptions.length > 2 || typeFilter !== 'all'

  const filtered = search !== '' || stateFilter !== 'all' || typeFilter !== 'all'
  const clearFilters = () => {
    setSearch('')
    const next = new URLSearchParams(params)
    next.delete('state')
    next.delete('type')
    setParams(next, { replace: true })
  }

  const detailsShown = wide ? panelPref : sheetOpen
  const toggleDetails = () => {
    if (!wide) {
      setSheetOpen((v) => !v)
      return
    }
    setPanelPref((v) => {
      try {
        localStorage.setItem(PANEL_KEY, v ? 'closed' : 'open')
      } catch {
        // Not remembered; still works.
      }
      return !v
    })
  }

  const linkTo = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('c', id)
    return { search: next.toString() }
  }
  const backTo = () => {
    const next = new URLSearchParams(params)
    next.delete('c')
    return { search: next.toString() }
  }

  // Day sections only make sense when the list is in time order.
  const groups: { key: string; group: DayGroup | null; rows: AdminConversation[] }[] = []
  for (const c of sorted) {
    const g = sort === 'name' ? null : dayGroup(c.lastActivityAt)
    const last = groups[groups.length - 1]
    if (last && last.group === g) last.rows.push(c)
    else groups.push({ key: `${g ?? 'all'}-${groups.length}`, group: g, rows: [c] })
  }

  const style = resizable ? ({ '--list-w': `${listWidth.width}px` } as CSSProperties) : undefined

  return (
    <div className="workspace" data-view={selectedId ? 'thread' : 'list'} style={style}>
      <section className="workspace__list" id="conversation-list" aria-labelledby="conversations-title">
        <div className="workspace__head">
          <div className="workspace__title-row">
            <h1 className="workspace__title" id="conversations-title">
              {tx(section.label)}
            </h1>
            {query.data && <span className="workspace__count">{number(all.length)}</span>}
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm workspace__refresh"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
              aria-label={tx(TEXT.refresh)}
              title={tx(TEXT.refresh)}
            >
              <Icon name="refresh" size={16} />
            </button>
          </div>
          <SearchField
            value={search}
            onChange={setSearch}
            label={tx(TEXT.searchByName)}
            clearLabel={tx(TEXT.clearSearch)}
          />
          {query.data && showTypeFilter && (
            <FilterChips
              options={typeOptions}
              value={typeFilter}
              onChange={(v) => setParam('type', v)}
              label={tx(TEXT.filterByType)}
              formatCount={number}
            />
          )}
        </div>
        {query.data && (
          <div className="workspace__filters">
            <FilterChips
              variant="tabs"
              options={stateOptions}
              value={stateFilter}
              onChange={(v) => setParam('state', v)}
              label={tx(TEXT.filterByStatus)}
              formatCount={number}
            />
            <div className="workspace__controls">
              <select
                className="select select--inline select--sm"
                value={sort}
                onChange={(e) => setParam('sort', e.target.value, 'recent')}
                aria-label={tx(TEXT.sortBy)}
              >
                <option value="recent">{tx(TEXT.sortRecent)}</option>
                <option value="oldest">{tx(TEXT.sortOldest)}</option>
                <option value="name">{tx(TEXT.sortName)}</option>
              </select>
            </div>
          </div>
        )}
        <div className="workspace__scroll">
          <QueryBoundary
            compact
            isLoading={query.isLoading}
            error={query.error}
            onRetry={() => void query.refetch()}
            isEmpty={all.length === 0}
            emptyTitle={tx(TEXT.noConversations)}
            emptyIcon="conversations"
          >
            {sorted.length === 0 ? (
              <EmptyState
                compact
                icon="search"
                title={tx(TEXT.noMatches)}
                action={
                  filtered && (
                    <button type="button" className="btn btn--sm" onClick={clearFilters}>
                      {tx(TEXT.clearFilters)}
                    </button>
                  )
                }
              />
            ) : (
              groups.map((g) => (
                <div className="conv-group" key={g.key}>
                  {g.group && <h2 className="conv-group__title">{tx(TEXT[GROUP_LABEL[g.group]])}</h2>}
                  <ul className="conv-list">
                    {g.rows.map((c) => (
                      <ConversationRow key={c.id} c={c} to={linkTo(c.id)} selected={c.id === selectedId} />
                    ))}
                  </ul>
                </div>
              ))
            )}
            {query.data?.truncated && <p className="list-footnote workspace__footnote">{tx(TEXT.truncated)}</p>}
          </QueryBoundary>
        </div>
      </section>

      {resizable && <Splitter {...listWidth} label={tx(TEXT.resizeList)} controls="conversation-list" />}

      <section
        className="workspace__thread"
        aria-label={selected ? conversationName(selected, untitled) : tx(section.label)}
      >
        {selected ? (
          <Thread
            key={selected.id}
            c={selected}
            backTo={backTo()}
            detailsShown={detailsShown}
            onToggleDetails={toggleDetails}
          />
        ) : selectedId && query.isLoading ? (
          <LoadingState />
        ) : selectedId && query.data ? (
          <EmptyState
            icon="info"
            title={tx(TEXT.conversationNotLoaded)}
            hint={tx(query.data.truncated ? TEXT.onlyRecentLoaded : TEXT.refreshIfNew)}
            action={
              <Link className="btn btn--sm" to={backTo()}>
                {tx(TEXT.backToList)}
              </Link>
            }
          />
        ) : (
          <EmptyState icon="conversations" title={tx(TEXT.selectConversation)} hint={tx(TEXT.selectConversationHint)} />
        )}
      </section>

      {selected && wide && panelPref && (
        <aside className="workspace__panel" aria-labelledby="conversation-details-title">
          <h2 className="workspace__panel-title" id="conversation-details-title">
            {tx(TEXT.details)}
          </h2>
          <ConversationDetails c={selected} />
        </aside>
      )}
      {selected && !wide && sheetOpen && (
        <Dialog variant="sheet" title={tx(TEXT.details)} onClose={() => setSheetOpen(false)}>
          <ConversationDetails c={selected} />
        </Dialog>
      )}
    </div>
  )
}

function countBy<T>(rows: readonly T[], key: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + 1
  return out
}

/* ------------------------------------------------------------------- list */

function TypedAvatar({ c, name, size }: { c: AdminConversation; name: string; size?: 'md' | 'lg' }) {
  const glyph = TYPE_GLYPH[c.type]
  return (
    <span className="typed-avatar">
      <Avatar name={name} seed={c.id} size={size} />
      {glyph && (
        <span className="typed-avatar__glyph" aria-hidden="true">
          <Icon name={glyph} size={11} />
        </span>
      )}
    </span>
  )
}

function ConversationRow({
  c,
  to,
  selected,
}: {
  c: AdminConversation
  to: { search: string }
  selected: boolean
}) {
  const tx = useText()
  const label = useLabel()
  const plural = usePlural()
  const { locale, dateTime } = useI18n()
  const name = conversationName(c, tx(TEXT.untitled))
  return (
    <li>
      <Link
        to={to}
        className={c.state === 'waiting_on_jawwid' ? 'conv-row conv-row--attention' : 'conv-row'}
        aria-current={selected ? 'true' : undefined}
      >
        <TypedAvatar c={c} name={name} />
        <span className="conv-row__body">
          <span className="conv-row__top">
            <span className="conv-row__name">{name}</span>
            <time className="conv-row__time" dateTime={c.lastActivityAt} title={dateTime(c.lastActivityAt)}>
              {listTime(c.lastActivityAt, locale)}
            </time>
          </span>
          <span className="conv-row__bottom">
            <span className="conv-row__sub">
              {label(CONVERSATION_TYPE, c.type)} · {plural(PLURAL.members, c.liveMembers)}
            </span>
            <ConversationStateBadge state={c.state} />
          </span>
        </span>
      </Link>
    </li>
  )
}

/* ----------------------------------------------------------------- thread */

type Side = 'contact' | 'staff' | 'system' | 'internal'

function sideOf(m: AdminMessage): Side {
  if (m.visibility === 'internal') return 'internal'
  if (m.authorKind === 'system' || m.type === 'system') return 'system'
  return m.authorKind === 'contact' ? 'contact' : 'staff'
}

function Thread({
  c,
  backTo,
  detailsShown,
  onToggleDetails,
}: {
  c: AdminConversation
  backTo: { search: string }
  detailsShown: boolean
  onToggleDetails: () => void
}) {
  const tx = useText()
  const label = useLabel()
  const plural = usePlural()
  const { locale, number } = useI18n()
  const name = conversationName(c, tx(TEXT.untitled))
  const query = useQuery({
    queryKey: qk.adminMessages(c.id),
    queryFn: () => adminApi.messages(c.id),
  })
  const messages = query.data ?? []
  const scrollRef = useRef<HTMLDivElement>(null)

  // A thread opens at its latest message, like every messaging app.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [query.data])

  return (
    <>
      <header className="thread-head">
        <Link to={backTo} className="btn btn--ghost btn--icon thread-head__back" aria-label={tx(TEXT.backToList)}>
          <Icon name="arrowBack" size={20} />
        </Link>
        <TypedAvatar c={c} name={name} />
        <div className="thread-head__text">
          <h2 className="thread-head__name">{name}</h2>
          <span className="thread-head__sub">
            {label(CONVERSATION_TYPE, c.type)} · {plural(PLURAL.members, c.liveMembers)} ·{' '}
            {fill(tx(TEXT.lastActive), { age: relativeTime(c.lastActivityAt, locale) })}
          </span>
        </div>
        <ConversationStateBadge state={c.state} />
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={onToggleDetails}
          aria-pressed={detailsShown}
          aria-label={tx(TEXT.showDetails)}
          title={tx(TEXT.showDetails)}
        >
          <Icon name="panel" />
        </button>
      </header>

      <div className="thread-body" ref={scrollRef}>
        <QueryBoundary
          compact
          isLoading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          isEmpty={messages.length === 0}
          emptyTitle={tx(TEXT.noMessages)}
          emptyIcon="conversations"
        >
          {messages.length >= MESSAGE_LIMIT && (
            <p className="thread-note">{fill(tx(TEXT.latestMessages), { n: number(MESSAGE_LIMIT) })}</p>
          )}
          <ol className="athread">
            {messages.map((m, i) => {
              const prev = messages[i - 1]
              const newDay = !prev || dayLabel(prev.createdAt, locale) !== dayLabel(m.createdAt, locale)
              const side = sideOf(m)
              const newAuthor =
                side !== 'system' &&
                (newDay ||
                  !prev ||
                  prev.authorName !== m.authorName ||
                  prev.authorKind !== m.authorKind ||
                  sideOf(prev) !== side)
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <li className="athread__day">
                      <span>{dayLabel(m.createdAt, locale)}</span>
                    </li>
                  )}
                  <MessageItem m={m} side={side} showAuthor={newAuthor} />
                </Fragment>
              )
            })}
          </ol>
        </QueryBoundary>
      </div>

      {/* Where a composer would be. This view only reads (/admin/*); the reply
          happens in the Chat workspace, where the server lets the super admin
          write (PD-8). */}
      <footer className="thread-readonly">
        <div className="thread-readonly__bar">
          <Icon name="lock" size={16} />
          <span>{tx(TEXT.readOnlyComposer)}</span>
          <Link to={`/chat/${encodeURIComponent(c.id)}`} className="btn btn--primary btn--sm thread-readonly__reply">
            {tx(TEXT.replyInChat)}
          </Link>
        </div>
      </footer>
    </>
  )
}

function MessageItem({ m, side, showAuthor }: { m: AdminMessage; side: Side; showAuthor: boolean }) {
  const tx = useText()
  const label = useLabel()
  const plural = usePlural()
  const { time, locale } = useI18n()
  const typeLabel = MESSAGE_TYPE[m.type] ? label(MESSAGE_TYPE, m.type) : null
  const hasAttachment = !m.deleted && (m.attachments > 0 || typeLabel !== null)

  if (side === 'system') {
    return (
      <li className="bubble-row bubble-row--system">
        <span className="sys-pill">
          {/* The body is the backend's `{ kind, ...facts }`: rendered as the chat workspace renders it, never raw. */}
          {m.body ? systemText(m.body, chatCopyFor(locale)) : label(AUTHOR_KIND, 'system')}
          <time dateTime={m.createdAt}>{time(m.createdAt)}</time>
        </span>
      </li>
    )
  }

  return (
    <li className={`bubble-row bubble-row--${side}`}>
      {showAuthor && (
        <div className="bubble-author">
          <span className="bubble-author__name">{m.authorName ?? tx(TEXT.unknownAuthor)}</span>
          <span className={`kind-chip kind-chip--${m.authorKind}`}>{label(AUTHOR_KIND, m.authorKind)}</span>
        </div>
      )}
      <div className="bubble">
        {side === 'internal' && (
          <span className="bubble__flag">
            <Icon name="lock" size={12} />
            {tx(TEXT.internal)}
          </span>
        )}
        {m.deleted ? (
          <em className="bubble__deleted">{tx(TEXT.deleted)}</em>
        ) : (
          <>
            {hasAttachment && (
              <span className="bubble__attachment">
                <Icon name="paperclip" size={14} />
                {typeLabel ?? plural(PLURAL.attachments, m.attachments)}
                {typeLabel && m.attachments > 1 && <> · {plural(PLURAL.attachments, m.attachments)}</>}
              </span>
            )}
            {m.body && <span className="bubble__text">{m.body}</span>}
          </>
        )}
        <span className="bubble__meta">
          {MODERATION[m.moderation] && (
            <Badge tone={m.moderation === 'rejected' ? 'danger' : 'warn'} dot>
              {label(MODERATION, m.moderation)}
            </Badge>
          )}
          <time dateTime={m.createdAt}>{time(m.createdAt)}</time>
        </span>
      </div>
    </li>
  )
}

/* ---------------------------------------------------------------- details */

function ConversationDetails({ c }: { c: AdminConversation }) {
  const tx = useText()
  const label = useLabel()
  const plural = usePlural()
  const { dateTime, locale } = useI18n()
  const [copied, setCopied] = useState(false)
  const name = conversationName(c, tx(TEXT.untitled))

  const copy = () => {
    void navigator.clipboard?.writeText(c.id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div className="dp">
      <div className="dp-hero">
        <TypedAvatar c={c} name={name} size="lg" />
        <div className="dp-hero__text">
          <div className="dp-hero__name">{name}</div>
          <ConversationStateBadge state={c.state} showOpen />
        </div>
      </div>

      <section className="dp-section">
        <h3 className="dp-section__title">{tx(TEXT.detailsConversation)}</h3>
        <dl className="dp-list">
          <div>
            <dt>{tx(TEXT.type)}</dt>
            <dd>{label(CONVERSATION_TYPE, c.type)}</dd>
          </div>
          <div>
            <dt>{tx(TEXT.membersLabel)}</dt>
            <dd>{plural(PLURAL.members, c.liveMembers)}</dd>
          </div>
          <div>
            <dt>{tx(TEXT.family)}</dt>
            <dd>{c.familyName ?? tx(TEXT.dash)}</dd>
          </div>
        </dl>
      </section>

      <section className="dp-section">
        <h3 className="dp-section__title">{tx(TEXT.detailsActivity)}</h3>
        <dl className="dp-list">
          <div>
            <dt>{tx(TEXT.lastActivity)}</dt>
            <dd>
              {relativeTime(c.lastActivityAt, locale)}
              <span className="dp-list__sub">{dateTime(c.lastActivityAt)}</span>
            </dd>
          </div>
          <div>
            <dt>{tx(TEXT.started)}</dt>
            <dd>{dateTime(c.createdAt)}</dd>
          </div>
          {c.archivedAt && (
            <div>
              <dt>{tx(TEXT.archived)}</dt>
              <dd>{dateTime(c.archivedAt)}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="dp-section">
        <h3 className="dp-section__title">{tx(TEXT.reference)}</h3>
        <div className="dp-ref">
          <code className="mono">{c.id}</code>
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={copy}
            aria-label={copied ? tx(TEXT.copied) : tx(TEXT.copyReference)}
            title={copied ? tx(TEXT.copied) : tx(TEXT.copyReference)}
          >
            <Icon name={copied ? 'check' : 'copy'} size={16} />
          </button>
        </div>
      </section>
    </div>
  )
}
