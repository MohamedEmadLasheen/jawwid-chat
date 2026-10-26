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
import { ConversationAvatar, conversationName, isGroup, isMuted, previewText } from './chatView'
import { useConversationPreferences } from './useChatActions'
import { TrialBadge, isTrialGroup } from '@/shared/components/TrialBadge'

type View = 'all' | 'unread' | 'favorites' | 'groups' | 'joined' | 'archived'

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
}: {
  conversations: ChatConversation[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** A message search hit: open its chat at that message. */
  onOpenMessage?: (conversationId: string, messageId: string) => void
  /** The header's buttons (New chat / New family group). */
  actions?: ReactNode
}) {
  const { locale, number } = useI18n()
  const copy = chatCopyFor(locale)
  const { staff } = useSession()
  const [search, setSearch] = useState('')
  const [view, setView] = useState<View>('all')
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
  const inView = (v: View) =>
    v === 'archived' ? archived
    : v === 'joined' ? joined
    : v === 'unread' ? active.filter((c) => (c.unreadCount ?? 0) > 0)
    : v === 'favorites' ? active.filter((c) => c.viewerState?.favorite)
    : v === 'groups' ? active.filter(isGroup)
    : active
  // Pinned first; otherwise the server's order (most recent activity first).
  const rows = [...inView(view)].sort((a, b) => Number(!!b.viewerState?.pinned) - Number(!!a.viewerState?.pinned))

  const options = [
    { value: 'all' as const, label: copy.filterAll, count: inView('all').length },
    { value: 'unread' as const, label: copy.filterUnread, count: inView('unread').length },
    { value: 'favorites' as const, label: copy.filterFavorites, count: inView('favorites').length },
    { value: 'groups' as const, label: copy.filterGroups, count: inView('groups').length },
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
          <span className="workspace__count">{number(active.length)}</span>
          <div className="cw-list__actions">{actions}</div>
        </div>
        <SearchField value={search} onChange={setSearch} label={onOpenMessage ? copy.searchList : copy.search} clearLabel={copy.clearSearch} />
        <div
          className="cw-filters"
          onWheel={(e) => {
            // A mouse wheel moves the one-line filter row sideways.
            const row = e.currentTarget.querySelector<HTMLElement>('.chips')
            if (!row || Math.abs(e.deltaY) <= Math.abs(e.deltaX) || row.scrollWidth <= row.clientWidth) return
            row.scrollLeft += getComputedStyle(row).direction === 'rtl' ? -e.deltaY : e.deltaY
          }}
        >
          <FilterChips options={options} value={view} onChange={setView} label={copy.filterLabel} formatCount={number} />
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
          <ul className="conv-list" aria-label={copy.title}>
            {rows.map((c) => (
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
                        <Avatar name={who || where || '?'} seed={m.authorId ?? m.authorKind} size="sm" src={m.authorAvatarUrl} />
                        <span className="cw-hit-row__main">
                          <span className="cw-hit-row__top">
                            <span className="cw-hit-row__where" dir="auto">{where}</span>
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
  const { dateTime } = useI18n()
  const prefs = useConversationPreferences()
  const name = conversationName(c, selfId, copy)
  const unread = c.unreadCount ?? 0
  const pinned = !!c.viewerState?.pinned
  const muted = isMuted(c)
  const archived = !!c.viewerState?.archived
  const favorite = !!c.viewerState?.favorite
  const preview = previewText(c.lastMessage, selfId, copy) || (copy.kind[c.type] ?? c.type)

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
            <span className="conv-row__name" dir="auto">{name}</span>
            {isTrialGroup(c) && <TrialBadge />}
            <time className="conv-row__time" dateTime={c.lastActivityAt} title={dateTime(c.lastActivityAt)}>
              {listTime(c.lastActivityAt, locale)}
            </time>
          </span>
          <span className="conv-row__bottom">
            <span className="conv-row__sub" dir="auto">{preview}</span>
            {c.needsReply && <Badge tone="now">{copy.needsReply}</Badge>}
            {favorite && (
              <span className="cw-row__mark cw-row__mark--favorite" title={copy.favoriteMark} aria-label={copy.favoriteMark}>
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
            {unread > 0 && (
              <span className="cw-unread" aria-label={copy.unread(unread)}>
                {unread}
              </span>
            )}
          </span>
          {(c.labels ?? []).length > 0 && (
            <span className="cw-row__labels" aria-label={copy.labels}>
              {c.labels!.map((l) => (
                <LabelChip key={l.id} label={l} />
              ))}
            </span>
          )}
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
