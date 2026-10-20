import { useMemo, useState, type ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { listTime } from '@/features/admin/copy'
import { Badge } from '@/shared/components/Badge'
import { EmptyState } from '@/shared/components/States'
import { FilterChips } from '@/shared/components/FilterChips'
import { Icon } from '@/shared/components/Icon'
import { Menu } from '@/shared/components/Menu'
import { SearchField } from '@/shared/components/SearchField'
import type { ChatConversation, ChatLabel } from './chatApi'
import { chatCopyFor } from './copy'
import { ConversationAvatar, conversationName, isGroup, isMuted, previewText } from './chatView'
import { LabelPickerDialog, LabelPill } from './LabelDialogs'
import { useChatLabels, useConversationPreferences } from './useChatActions'

type View = 'all' | 'unread' | 'favorites' | 'groups' | 'archived' | `label:${string}`

/** Label tags shown on a row before the rest collapse into "+n". */
const ROW_LABELS = 2

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
  actions,
  onManageLabels,
}: {
  conversations: ChatConversation[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** The header's buttons (New chat / New family group). */
  actions?: ReactNode
  /** Opens the organization's label manager (staff). */
  onManageLabels?: () => void
}) {
  const { locale, number } = useI18n()
  const copy = chatCopyFor(locale)
  const { staff } = useSession()
  const [search, setSearch] = useState('')
  const [view, setView] = useState<View>('all')
  const [labelling, setLabelling] = useState<string | null>(null)
  const labels = useChatLabels().data ?? []
  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels])

  const named = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return conversations.filter(
      (c) =>
        !needle ||
        [conversationName(c, staff?.id, copy), ...(c.members ?? []).map((m) => m.displayName)].some((t) =>
          t.toLocaleLowerCase().includes(needle),
        ),
    )
  }, [conversations, search, staff?.id, copy])

  const archived = named.filter((c) => c.viewerState?.archived)
  const active = named.filter((c) => !c.viewerState?.archived)
  const inView = (v: View) =>
    v === 'archived' ? archived
    : v === 'unread' ? active.filter((c) => (c.unreadCount ?? 0) > 0)
    : v === 'favorites' ? active.filter((c) => c.viewerState?.favorite)
    : v === 'groups' ? active.filter(isGroup)
    : v.startsWith('label:') ? active.filter((c) => c.labelIds?.includes(v.slice(6)))
    : active
  // Pinned first; otherwise the server's order (most recent activity first).
  const rows = [...inView(view)].sort((a, b) => Number(!!b.viewerState?.pinned) - Number(!!a.viewerState?.pinned))

  const options = [
    { value: 'all' as const, label: copy.filterAll, count: inView('all').length },
    { value: 'unread' as const, label: copy.filterUnread, count: inView('unread').length },
    { value: 'favorites' as const, label: copy.filterFavorites, count: inView('favorites').length },
    { value: 'groups' as const, label: copy.filterGroups, count: inView('groups').length },
    // One chip per label that is on a chat in view (or is the one selected).
    ...labels
      .map((l) => ({ l, value: `label:${l.id}` as View, count: inView(`label:${l.id}`).length }))
      .filter(({ value, count }) => count > 0 || view === value)
      .map(({ l, value, count }) => ({
        value,
        label: l.name,
        count,
        marker: <span className={`cw-label__dot cw-label-tone--${l.color}`} aria-hidden="true" />,
      })),
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
        <SearchField value={search} onChange={setSearch} label={copy.search} clearLabel={copy.clearSearch} />
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
          {onManageLabels && (
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm cw-filters__manage"
              onClick={onManageLabels}
              aria-label={copy.manageLabels}
              title={copy.manageLabels}
            >
              <Icon name="tag" size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="workspace__scroll">
        {conversations.length === 0 ? (
          <EmptyState compact icon="conversations" title={copy.empty} />
        ) : rows.length === 0 ? (
          <EmptyState compact icon="search" title={copy.noMatches} />
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
                labels={(c.labelIds ?? []).map((id) => labelById.get(id)).filter((l): l is ChatLabel => !!l)}
                onLabel={onManageLabels ? () => setLabelling(c.id) : undefined}
              />
            ))}
          </ul>
        )}
      </div>
      {labelling && conversations.some((c) => c.id === labelling) && (
        <LabelPickerDialog
          conversation={conversations.find((c) => c.id === labelling)!}
          onClose={() => setLabelling(null)}
          onManage={() => {
            setLabelling(null)
            onManageLabels?.()
          }}
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
  labels,
  onLabel,
}: {
  c: ChatConversation
  selected: boolean
  onSelect: () => void
  selfId: string | undefined
  locale: 'ar' | 'en'
  labels: ChatLabel[]
  /** Opens the label picker for this chat; absent where labels are not offered. */
  onLabel?: () => void
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
          {labels.length > 0 && (
            <span className="cw-row__labels" aria-label={copy.labels}>
              {labels.slice(0, ROW_LABELS).map((l) => (
                <LabelPill key={l.id} label={l} />
              ))}
              {labels.length > ROW_LABELS && (
                <span className="cw-label cw-label--more" title={labels.slice(ROW_LABELS).map((l) => l.name).join('، ')}>
                  {copy.moreLabels(labels.length - ROW_LABELS)}
                </span>
              )}
            </span>
          )}
        </span>
      </button>
      <Menu
        label={`${copy.chatActions}: ${name}`}
        className="cw-row__menu"
        items={[
          { key: 'pin', label: pinned ? copy.unpin : copy.pin, icon: 'pin', onSelect: () => prefs.pin(c.id, !pinned) },
          {
            key: 'favorite',
            label: favorite ? copy.unfavorite : copy.favorite,
            icon: 'heart',
            onSelect: () => prefs.favorite(c.id, !favorite),
          },
          ...(onLabel ? [{ key: 'labels', label: copy.labelChat, icon: 'tag' as const, onSelect: onLabel }] : []),
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
