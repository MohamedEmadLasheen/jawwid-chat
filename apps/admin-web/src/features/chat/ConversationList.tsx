import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { listTime } from '@/features/admin/copy'
import { Badge } from '@/shared/components/Badge'
import { EmptyState } from '@/shared/components/States'
import { FilterChips } from '@/shared/components/FilterChips'
import { Icon } from '@/shared/components/Icon'
import { Menu } from '@/shared/components/Menu'
import { SearchField } from '@/shared/components/SearchField'
import { SUPERVISION_SEAT } from './SeatParts'
import { chatApi, chatKeys, type ChatConversation, type ChatLabel } from './chatApi'
import { Highlighted, SEARCH_ACROSS_MIN, searchable, snippetAround, useDebounced } from './search'
import { Avatar } from '@/shared/components/Avatar'
import { chatCopyFor } from './copy'
import { LabelChip, LabelsDialog } from './LabelsDialog'
import { ConversationAvatar, conversationName, isGroup, isMuted, previewParts, toneOfKind } from './chatView'
import { useConversationPreferences } from './useChatActions'
import { groupQueue, waitTone, waitedFor } from './queue'
import { TrialBadge, isTrialGroup } from '@/shared/components/TrialBadge'

export type View = 'all' | 'unread' | 'favorites' | 'groups' | 'joined' | 'archived' | 'waiting'

/**
 * The conversation list. What is in it is exactly what the server returned
 * for this viewer; the filters and the order below are views of that list.
 * Archived chats leave the main views and gather under Archived, pinned ones
 * lead, and both are this viewer's preferences only.
 */
export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onOpenMessage,
  actions,
  initialView = 'all',
}: {
  conversations: ChatConversation[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** A message search hit: open its chat at that message. */
  onOpenMessage?: (conversationId: string, messageId: string) => void
  /** The header's buttons (New chat / New family group). */
  actions?: ReactNode
  /** PD-44: the view to open on (the Dashboard's tile opens Waiting for a reply). */
  initialView?: View
}) {
  const { locale, number } = useI18n()
  const copy = chatCopyFor(locale)
  const { staff } = useSession()
  const [search, setSearch] = useState('')
  const [view, setView] = useState<View>(initialView)
  const [labelId, setLabelId] = useState<string | null>(null)
  const [labelling, setLabelling] = useState<string | null>(null)

  // The viewer's labels in use, from the list itself: a label on no chat has
  // nothing to filter. Labels are private, so these are only ever one's own.
  const usedLabels = useMemo(() => {
    const byId = new Map<string, ChatLabel>()
    for (const c of conversations) for (const l of c.labels ?? []) byId.set(l.id, l)
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [conversations])
  const activeLabel = labelId && usedLabels.some((l) => l.id === labelId) ? labelId : null

  const named = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return conversations.filter(
      (c) =>
        (!activeLabel || (c.labels ?? []).some((l) => l.id === activeLabel)) &&
        (!needle ||
        [conversationName(c, staff?.id, copy), ...(c.members ?? []).map((m) => m.displayName)].some((t) =>
          t.toLocaleLowerCase().includes(needle),
        )),
    )
  }, [conversations, search, staff?.id, copy, activeLabel])

  // The same box also searches message text across every chat in the list
  // (owner decision 2026-10-20); the server answers only from what this
  // viewer may read.
  const term = useDebounced(search.trim())
  const textSearch = !!onOpenMessage && searchable(term, SEARCH_ACROSS_MIN)
  const found = useQuery({
    queryKey: chatKeys.searchAll(term),
    queryFn: () => chatApi.searchAll(term),
    enabled: textSearch,
    staleTime: 30_000,
  })
  const hits = textSearch ? found.data?.hits ?? [] : []
  const byId = useMemo(() => new Map(conversations.map((c) => [c.id, c])), [conversations])

  const archived = named.filter((c) => c.viewerState?.archived)
  // PD-35: groups a teacher supervisor joined to support sit under their own
  // filter, so they never crowd the main list.
  const joined = named.filter((c) => !c.viewerState?.archived && c.viewerState?.seat?.reason === SUPERVISION_SEAT)
  const active = named.filter((c) => !c.viewerState?.archived && c.viewerState?.seat?.reason !== SUPERVISION_SEAT)
  // PD-44: exactly what the Dashboard's waiting tile counts -- the server's
  // waiting_on_jawwid, not closed -- across the whole list, this viewer's own
  // archive and joined groups included, so the tile and this view agree.
  const waiting = named.filter((c) => c.state === 'waiting_on_jawwid' && c.archivedAt === null)
  const inView = (v: View) =>
    v === 'waiting' ? waiting
    : v === 'archived' ? archived
    : v === 'joined' ? joined
    : v === 'unread' ? active.filter((c) => (c.unreadCount ?? 0) > 0)
    : v === 'favorites' ? active.filter((c) => c.viewerState?.favorite)
    : v === 'groups' ? active.filter(isGroup)
    : active
  // PD-36: a chat that has asked the viewer in, not yet opened, leads -- above
  // pinned. Then pinned; otherwise the server's order (most recent activity first).
  const rank = (c: ChatConversation) => (isUnseenSummons(c) ? 2 : c.viewerState?.pinned ? 1 : 0)
  // A work queue, not a flat inbox: owed an answer (longest wait first), then
  // unread, then the rest by recency. The tabs filter within this grouping.
  const sections = groupQueue(inView(view), rank)
  const rows = sections.flatMap((s) => s.rows)
  // One quiet section alone needs no heading: it is simply the list.
  const headed = sections.length > 1 || (sections.length === 1 && sections[0]!.key !== 'rest')

  const options = [
    { value: 'all' as const, label: copy.filterAll, count: inView('all').length },
    { value: 'unread' as const, label: copy.filterUnread, count: inView('unread').length },
    { value: 'favorites' as const, label: copy.filterFavorites, count: inView('favorites').length },
    { value: 'groups' as const, label: copy.filterGroups, count: inView('groups').length },
    ...(waiting.length > 0 || view === 'waiting'
      ? [{ value: 'waiting' as const, label: copy.filterWaiting, count: waiting.length }]
      : []),
    ...(joined.length > 0 || view === 'joined'
      ? [{ value: 'joined' as const, label: copy.filterJoined, count: joined.length }]
      : []),
    ...(archived.length > 0 || view === 'archived'
      ? [{ value: 'archived' as const, label: copy.filterArchived, count: archived.length }]
      : []),
  ]

  return (
    <>
      <div className="workspace__head">
        <div className="workspace__title-row">
          <h1 className="workspace__title">{copy.title}</h1>
          <div className="cw-list__actions">{actions}</div>
        </div>
        <SearchField value={search} onChange={setSearch} label={onOpenMessage ? copy.searchList : copy.search} clearLabel={copy.clearSearch} />
        <div
          className="cw-filters"
          onWheel={(e) => {
            // A mouse wheel moves the one-line filter row sideways.
            const row = e.currentTarget.querySelector<HTMLElement>('.seg')
            if (!row || Math.abs(e.deltaY) <= Math.abs(e.deltaX) || row.scrollWidth <= row.clientWidth) return
            row.scrollLeft += getComputedStyle(row).direction === 'rtl' ? -e.deltaY : e.deltaY
          }}
        >
          <FilterChips variant="tabs" options={options} value={view} onChange={setView} label={copy.filterLabel} formatCount={number} />
        </div>
        {usedLabels.length > 0 && (
          <div className="cw-label-filter" role="group" aria-label={copy.labelFilter}>
            {usedLabels.map((l) => (
              <button
                key={l.id}
                type="button"
                className="cw-label-filter__item"
                aria-pressed={activeLabel === l.id}
                onClick={() => setLabelId(activeLabel === l.id ? null : l.id)}
              >
                <LabelChip label={l} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="workspace__scroll">
        {conversations.length === 0 ? (
          <EmptyState compact icon="conversations" title={copy.empty} />
        ) : rows.length === 0 ? (
          !textSearch && <EmptyState compact icon="search" title={copy.noMatches} />
        ) : (
          sections.map((s) => (
            <section key={s.key} className={`cw-sec cw-sec--${s.key}`}>
              {headed && (
                <h2 className="cw-sec__title">
                  {copy.section[s.key]}
                  <span className={s.key === 'needs' ? 'count count--urgent' : s.key === 'unread' ? 'count' : 'count count--quiet'}>
                    {number(s.rows.length)}
                  </span>
                </h2>
              )}
              <ul className="conv-list" aria-label={headed ? copy.section[s.key] : copy.title}>
                {s.rows.map((c) => (
                  <ConversationRow
                    key={c.id}
                    c={c}
                    selected={c.id === selectedId}
                    onSelect={() => onSelect(c.id)}
                    selfId={staff?.id}
                    locale={locale}
                    onLabel={() => setLabelling(c.id)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
        {textSearch && (
          <section className="cw-hits" aria-label={copy.searchMessages}>
            <h2 className="cw-hits__title">{copy.searchMessages}</h2>
            {found.isLoading ? (
              <p className="cw-hits__empty">…</p>
            ) : hits.length === 0 ? (
              <p className="cw-hits__empty">{copy.searchMessagesNone}</p>
            ) : (
              <ul className="cw-hits__list">
                {hits.map(({ conversationId, message: m }) => {
                  const c = byId.get(conversationId)
                  const where = c ? conversationName(c, staff?.id, copy) : ''
                  const who = m.authorId === staff?.id ? copy.you : m.authorDisplayName ?? ''
                  return (
                    <li key={m.id}>
                      <button type="button" className="cw-hit-row" onClick={() => onOpenMessage?.(conversationId, m.id)}>
                        <span className={`cw-who cw-who--${toneOfKind(m.authorKind)}`}>
                          <Avatar name={who || where || '?'} seed={m.authorId ?? m.authorKind} size="sm" src={m.authorAvatarUrl} />
                        </span>
                        <span className="cw-hit-row__main">
                          <span className="cw-hit-row__top">
                            <span className="cw-hit-row__where">
                              <bdi className="cw-line">{where}</bdi>
                            </span>
                            <time className="cw-hit-row__time" dateTime={m.createdAt}>{listTime(m.createdAt, locale)}</time>
                          </span>
                          <span className="cw-hit-row__body" dir="auto">
                            {who && <span className="cw-hit-row__who">{who}: </span>}
                            <Highlighted text={snippetAround(m.body ?? '', term)} query={term} />
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {hits.length >= 40 && <p className="cw-hits__empty">{copy.searchMessagesNewest}</p>}
          </section>
        )}
      </div>
      {labelling && conversations.some((c) => c.id === labelling) && (
        <LabelsDialog
          conversationId={labelling}
          current={conversations.find((c) => c.id === labelling)!.labels ?? []}
          onClose={() => setLabelling(null)}
        />
      )}
    </>
  )
}

/** PD-36: the viewer was asked into this chat and has not opened it since. */
export function isUnseenSummons(c: ChatConversation): boolean {
  const m = c.viewerState?.mention
  return !!m && m.kind === 'summons' && m.state === 'pending' && !m.seen
}

function ConversationRow({
  c,
  selected,
  onSelect,
  selfId,
  locale,
  onLabel,
}: {
  c: ChatConversation
  selected: boolean
  onSelect: () => void
  selfId: string | undefined
  locale: 'ar' | 'en'
  /** Opens this chat's labels (the viewer's own). */
  onLabel: () => void
}) {
  const copy = chatCopyFor(locale)
  const { dateTime, number } = useI18n()
  const prefs = useConversationPreferences()
  const name = conversationName(c, selfId, copy)
  const unread = c.unreadCount ?? 0
  const pinned = !!c.viewerState?.pinned
  const muted = isMuted(c)
  const archived = !!c.viewerState?.archived
  const favorite = !!c.viewerState?.favorite
  const said = previewParts(c.lastMessage, selfId, copy, isGroup(c) ? c.members : undefined)
  const preview = said.text || (copy.kind[c.type] ?? c.type)
  const mention = c.viewerState?.mention ?? null
  const summoned = mention?.kind === 'summons' && mention.state === 'pending'
  const covering = c.cover && c.cover.coverId === selfId ? copy.coveringFor(c.cover.supervisorName) : null
  const age = c.needsReply ? waitedFor(c.lastActivityAt, locale) : ''

  return (
    <li className="cw-row">
      <button
        type="button"
        className={unread > 0 ? 'conv-row cw-row__main cw-row__main--unread' : 'conv-row cw-row__main'}
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
      >
        <ConversationAvatar c={c} name={name} selfId={selfId} />
        <span className="conv-row__body">
          <span className="conv-row__top">
            <span className="conv-row__name">
              <bdi className="cw-line">{name}</bdi>
            </span>
            {isTrialGroup(c) && <TrialBadge />}
            {/* Owed an answer: how long it has waited is the row's one emphasised fact (grey, then amber, then red). */}
            {c.needsReply ? (
              <span
                className={`cw-row__waited cw-wait--${waitTone(c.lastActivityAt)}`}
                title={dateTime(c.lastActivityAt)}
                aria-label={copy.waitedLabel(age)}
              >
                <Icon name="hourglass" size={14} />
                {age}
              </span>
            ) : (
              <time className="conv-row__time" dateTime={c.lastActivityAt} title={dateTime(c.lastActivityAt)}>
                {listTime(c.lastActivityAt, locale)}
              </time>
            )}
          </span>
          <span className="conv-row__bottom">
            <span className="conv-row__sub">
              {/* Why it is here, in words: who said what last. "You" or the writer leads in the pane's direction; what was said follows in its own. */}
              {said.who && (
                <span className="cw-row__who">
                  <bdi>{said.who}</bdi>:
                </span>
              )}
              <bdi className="cw-line">{preview}</bdi>
            </span>
            {/* Marks are quiet glyphs: what this viewer set on the chat, never its state. */}
            <span className="cw-row__marks">
              {mention?.kind === 'member' && !mention.seen && (
                <span className="cw-row__mark cw-row__mark--mention" title={copy.mentionedMark} aria-label={copy.mentionedMark}>
                  <Icon name="at" size={14} />
                </span>
              )}
              {covering && (
                <span className="cw-row__mark cw-row__mark--cover" title={covering} aria-label={covering}>
                  <Icon name="swap" size={14} />
                  <span className="cw-row__word">{copy.covering}</span>
                </span>
              )}
              {(c.labels ?? []).map((l) => (
                <span key={l.id} className={`cw-row__label cw-tone--${l.color}`} role="img" title={l.name} aria-label={l.name} />
              ))}
              {favorite && (
                <span className="cw-row__mark" title={copy.favoriteMark} aria-label={copy.favoriteMark}>
                  <Icon name="heart" size={14} />
                </span>
              )}
              {muted && (
                <span className="cw-row__mark" title={copy.mutedMark} aria-label={copy.mutedMark}>
                  <Icon name="bellOff" size={14} />
                </span>
              )}
              {pinned && (
                <span className="cw-row__mark" title={copy.pinnedMark} aria-label={copy.pinnedMark}>
                  <Icon name="pin" size={14} />
                </span>
              )}
            </span>
            {/* Asked in (someone wants this viewer to act), else what is unread. */}
            {summoned ? (
              <Badge tone="waiting">{copy.mentionedBadge}</Badge>
            ) : (
              unread > 0 && (
                <span className="cw-unread" aria-label={copy.unread(unread)}>
                  {number(unread)}
                </span>
              )
            )}
          </span>
        </span>
      </button>
      <Menu
        label={`${copy.chatActions}: ${name}`}
        className="cw-row__menu"
        items={[
          { key: 'pin', label: pinned ? copy.unpin : copy.pin, icon: 'pin', onSelect: () => prefs.pin(c.id, !pinned) },
          { key: 'favorite', label: favorite ? copy.unfavorite : copy.favorite, icon: 'heart', onSelect: () => prefs.favorite(c.id, !favorite) },
          // Staff only server-side; the Admin Web viewer is always staff.
          { key: 'labels', label: copy.labelsMenu, icon: 'tag', onSelect: onLabel },
          { key: 'mute', label: muted ? copy.unmute : copy.mute, icon: muted ? 'notifications' : 'bellOff', onSelect: () => prefs.mute(c.id, !muted) },
          {
            key: 'archive',
            label: archived ? copy.unarchive : copy.archive,
            icon: 'archive',
            onSelect: () => prefs.archive(c.id, !archived),
          },
        ]}
      />
    </li>
  )
}
