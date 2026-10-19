import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { ApiError } from '@/core/api/errors'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { Dialog } from '@/shared/components/Dialog'
import { Icon, type IconName } from '@/shared/components/Icon'
import { SearchField } from '@/shared/components/SearchField'
import { ErrorState, LoadingState } from '@/shared/components/States'
import { useCall } from '@/features/calls/CallProvider'
import type { ChatConversation } from '@/features/chat/chatApi'
import { chatCopyFor } from '@/features/chat/copy'
import { listTime } from '@/features/admin/copy'
import { callsPageKeys, type AccountCallRow, type ScheduledCall, type ScheduledCallState } from './api'
import {
  useAccountHistory,
  useCallActions,
  useCallsCopy,
  useCancelScheduled,
  useConversationNaming,
  useConversations,
  useUpcoming,
} from './hooks'
import { callDirection, historyName, isJoinable, nameMatches } from './model'
import { onListKeyDown } from './listKeys'
import { useNow } from './ScheduledCallCard'
import { MemberPickerDialog, type PickerMode } from './MemberPickerDialog'
import { ScheduleCallDialog } from './ScheduleCallDialog'
import { CallLinkDialog } from './CallLinkDialog'
import './calls-page.css'

type Flow =
  | { kind: 'none' }
  | { kind: 'picker'; mode: PickerMode }
  | { kind: 'schedule'; conversation: ChatConversation }
  | { kind: 'link'; conversation: ChatConversation }

export function StateBadge({ state }: { state: ScheduledCallState }) {
  const copy = useCallsCopy()
  switch (state) {
    case 'open':
      return <Badge tone="ok" dot>{copy.stateOpen}</Badge>
    case 'upcoming':
      return <Badge tone="info">{copy.stateUpcoming}</Badge>
    case 'cancelled':
      return <Badge tone="neutral">{copy.stateCancelled}</Badge>
    default:
      return <Badge tone="neutral">{copy.stateOver}</Badge>
  }
}

/* --------------------------------------------------------------- upcoming */

function UpcomingRow({
  call,
  name,
  now,
  onCancel,
}: {
  call: ScheduledCall
  name: string
  now: number
  onCancel: (c: ScheduledCall) => void
}) {
  const copy = useCallsCopy()
  const { dateTime } = useI18n()
  const actions = useCallActions()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const open = call.state !== 'cancelled' && isJoinable(call.joinableFrom, call.joinableUntil, now)
  // The server's state, corrected by the clock it told us to use.
  const state: ScheduledCallState = call.state === 'cancelled' ? 'cancelled' : open ? 'open' : call.state

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  return (
    <li className="cp-row" data-testid="upcoming-row">
      <span className="cp-row__glyph" aria-hidden="true">
        <Icon name={call.kind === 'link' ? 'link' : 'calendar'} size={18} />
      </span>
      <span className="cp-row__body">
        <span className="cp-row__name">{name}</span>
        <span className="cp-row__sub">
          <time dateTime={call.startsAt}>{dateTime(call.startsAt)}</time>
        </span>
        <span className="cp-row__badges">
          {call.kind === 'link' && <Badge tone="info">{copy.linkBadge}</Badge>}
          <StateBadge state={state} />
        </span>
      </span>
      <span className="cp-row__end">
        {open && (
          <button
            type="button"
            className="btn btn--sm btn--primary"
            data-cp-item
            disabled={!actions.available || actions.busy}
            onClick={() => void actions.join(call)}
            aria-label={`${copy.join} — ${name}`}
          >
            {copy.join}
          </button>
        )}
        {call.canCancel && call.state !== 'cancelled' && (
          <div
            className="cp-menu"
            ref={menuRef}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && menuOpen) {
                e.stopPropagation()
                setMenuOpen(false)
              }
            }}
          >
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              data-cp-item
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={copy.rowMenu(name)}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <Icon name="more" size={18} />
            </button>
            {menuOpen && (
              <div className="cp-menu__popover" role="menu" aria-label={copy.rowMenu(name)}>
                <button
                  type="button"
                  role="menuitem"
                  className="cp-menu-list__item cp-menu-list__item--danger"
                  autoFocus
                  onClick={() => {
                    setMenuOpen(false)
                    onCancel(call)
                  }}
                >
                  {copy.cancelCall}
                </button>
              </div>
            )}
          </div>
        )}
      </span>
    </li>
  )
}

/* ----------------------------------------------------------------- recent */

function RecentRow({
  row,
  name,
  conversation,
  selfId,
}: {
  row: AccountCallRow
  name: string
  conversation: ChatConversation | undefined
  selfId: string | undefined
}) {
  const copy = useCallsCopy()
  const { dateTime, locale } = useI18n()
  const actions = useCallActions()
  const direction = callDirection(row, selfId)
  const missed = row.outcome === 'missed'
  const status =
    row.outcome === 'answered' ? copy.answered
    : row.outcome === 'missed' ? copy.missed
    : row.outcome === 'declined' ? copy.declined
    : row.outcome ?? copy.ongoing

  return (
    <li className="cp-row" data-testid="recent-row" data-direction={direction} data-outcome={row.outcome ?? ''}>
      <Avatar name={name} seed={row.conversationId} size="sm" />
      <span className="cp-row__body">
        <span className="cp-row__top">
          <span className={missed ? 'cp-row__name cp-row__name--missed' : 'cp-row__name'}>{name}</span>
          <time className="cp-row__time" dateTime={row.startedAt} title={dateTime(row.startedAt)}>
            {listTime(row.startedAt, locale)}
          </time>
        </span>
        <span className={missed ? 'cp-row__sub cp-row__sub--missed' : 'cp-row__sub'}>
          <Icon name={direction === 'outgoing' ? 'callOutgoing' : 'callIncoming'} size={14} />
          <span className="sr-only">{direction === 'outgoing' ? copy.outgoing : copy.incoming}</span>
          <span>{status}</span>
          {row.durationSeconds ? <span dir="ltr">· {copy.duration(row.durationSeconds)}</span> : null}
        </span>
      </span>
      <span className="cp-row__end">
        {conversation && (
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm cp-row__call"
            data-cp-item
            disabled={!actions.available || actions.busy}
            aria-label={copy.callTo(name)}
            onClick={() => void actions.startCall(conversation)}
          >
            <Icon name="calls" size={16} />
          </button>
        )}
      </span>
    </li>
  )
}

/* ------------------------------------------------------------------- page */

const TILES: Array<{ mode: PickerMode; icon: IconName; label: 'startCall' | 'newLink' | 'selectMember' | 'scheduleCall'; brand?: boolean }> = [
  { mode: 'call', icon: 'calls', label: 'startCall', brand: true },
  { mode: 'link', icon: 'link', label: 'newLink' },
  { mode: 'select', icon: 'users', label: 'selectMember' },
  { mode: 'schedule', icon: 'calendarPlus', label: 'scheduleCall' },
]

/**
 * THE CALLS PAGE (PD-13), for operators at /calls and the super admin at
 * /admin/calls. A list on the inline start (Upcoming, Favorites, Recent) and
 * four actions in the middle, like a desktop messenger's Calls tab. Voice
 * only. Every list is the server's answer for THIS account; every action is
 * decided again by the server, and the call itself runs in the one existing
 * call window.
 */
export function CallsPage() {
  const copy = useCallsCopy()
  const { locale } = useI18n()
  const chat = chatCopyFor(locale)
  const { staff } = useSession()
  const selfId = staff?.id
  const queryClient = useQueryClient()
  const { state: callState } = useCall()
  const conversations = useConversations()
  const name = useConversationNaming()
  const upcoming = useUpcoming()
  const history = useAccountHistory()
  const cancel = useCancelScheduled()
  const actions = useCallActions()
  const now = useNow()
  const [query, setQuery] = useState('')
  const [flow, setFlow] = useState<Flow>({ kind: 'none' })
  const [notice, setNotice] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<ScheduledCall | null>(null)

  // History is the server's record: re-read it when a call this tab saw ends.
  useEffect(() => {
    if (callState.phase === 'ended') void queryClient.invalidateQueries({ queryKey: callsPageKeys.history })
  }, [callState.phase, queryClient])

  const closeFlow = useCallback(() => setFlow({ kind: 'none' }), [])
  const resetCancel = cancel.reset
  const closeCancel = useCallback(() => {
    setCancelling(null)
    resetCancel()
  }, [resetCancel])
  const onSchedule = useCallback((c: ChatConversation) => setFlow({ kind: 'schedule', conversation: c }), [])
  const onLink = useCallback((c: ChatConversation) => setFlow({ kind: 'link', conversation: c }), [])

  const upcomingName = useCallback(
    (c: ScheduledCall) => c.title ?? name(conversations.byId.get(c.conversationId), copy.cardScheduled),
    [conversations.byId, copy.cardScheduled, name],
  )

  const upcomingRows = useMemo(
    () =>
      (upcoming.data ?? []).filter(
        (c) => nameMatches(upcomingName(c), query) || nameMatches(name(conversations.byId.get(c.conversationId)), query),
      ),
    [conversations.byId, name, query, upcoming.data, upcomingName],
  )
  const favorites = useMemo(
    () => (conversations.data ?? []).filter((c) => c.viewerState?.pinned && nameMatches(name(c), query)),
    [conversations.data, name, query],
  )
  const recentRows = useMemo(
    () =>
      (history.data?.pages ?? [])
        .flatMap((p) => p.items)
        .map((row) => {
          const conversation = conversations.byId.get(row.conversationId)
          return { row, conversation, name: historyName(row, selfId, conversation, chat) }
        })
        .filter((r) => nameMatches(r.name, query)),
    [chat, conversations.byId, history.data, query, selfId],
  )

  const searching = query.trim().length > 0

  return (
    <div className="cp-page">
      <section className="cp-side" aria-labelledby="cp-title">
        <div className="cp-side__head">
          <h1 className="cp-side__title" id="cp-title">
            {copy.title}
          </h1>
          <SearchField value={query} onChange={setQuery} label={copy.search} clearLabel={copy.clearSearch} />
        </div>

        <div className="cp-side__scroll">
          <section className="cp-section" aria-labelledby="cp-upcoming">
            <h2 className="cp-section__title" id="cp-upcoming">
              {copy.upcoming}
            </h2>
            {upcoming.isLoading ? (
              <LoadingState compact />
            ) : upcoming.error ? (
              <ErrorState compact error={upcoming.error} onRetry={() => void upcoming.refetch()} />
            ) : upcomingRows.length === 0 ? (
              <p className="cp-empty">{searching ? copy.noMatches : copy.noUpcoming}</p>
            ) : (
              <ul className="cp-list" onKeyDown={onListKeyDown}>
                {upcomingRows.map((c) => (
                  <UpcomingRow key={c.id} call={c} name={upcomingName(c)} now={now} onCancel={setCancelling} />
                ))}
              </ul>
            )}
          </section>

          <section className="cp-section" aria-labelledby="cp-favorites">
            <h2 className="cp-section__title" id="cp-favorites">
              {copy.favorites}
            </h2>
            {conversations.isLoading ? (
              <LoadingState compact />
            ) : conversations.error ? (
              <ErrorState compact error={conversations.error} onRetry={() => void conversations.refetch()} />
            ) : favorites.length === 0 ? (
              <p className="cp-empty">{searching ? copy.noMatches : copy.noFavorites}</p>
            ) : (
              <ul className="cp-list" onKeyDown={onListKeyDown}>
                {favorites.map((c) => {
                  const n = name(c)
                  return (
                    <li className="cp-row" key={c.id} data-testid="favorite-row">
                      <Avatar name={n} seed={c.id} size="sm" />
                      <span className="cp-row__body">
                        <span className="cp-row__name">{n}</span>
                        <span className="cp-row__sub">{chat.kind[c.type] ?? c.type}</span>
                      </span>
                      <span className="cp-row__end">
                        <button
                          type="button"
                          className="btn btn--ghost btn--icon btn--sm cp-row__call"
                          data-cp-item
                          disabled={!actions.available || actions.busy}
                          aria-label={copy.callTo(n)}
                          onClick={() => void actions.startCall(c)}
                        >
                          <Icon name="calls" size={16} />
                        </button>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="cp-section" aria-labelledby="cp-recent">
            <h2 className="cp-section__title" id="cp-recent">
              {copy.recent}
            </h2>
            {history.isLoading ? (
              <LoadingState compact />
            ) : history.error ? (
              <ErrorState compact error={history.error} onRetry={() => void history.refetch()} />
            ) : recentRows.length === 0 ? (
              <p className="cp-empty">{searching ? copy.noMatches : copy.noRecent}</p>
            ) : (
              <ul className="cp-list" onKeyDown={onListKeyDown}>
                {recentRows.map((r) => (
                  <RecentRow key={r.row.id} row={r.row} name={r.name} conversation={r.conversation} selfId={selfId} />
                ))}
              </ul>
            )}
            {history.hasNextPage && (
              <button
                type="button"
                className="btn btn--sm btn--ghost cp-more"
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                {copy.loadMore}
              </button>
            )}
          </section>
        </div>
      </section>

      <section className="cp-main" aria-label={copy.actions}>
        {notice && (
          <div className="banner banner--info cp-notice" role="status">
            <span>{notice}</span>
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              aria-label={copy.dismiss}
              onClick={() => setNotice(null)}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        <div className="cp-tiles">
          {TILES.map((t) => (
            <button
              key={t.mode}
              type="button"
              className={t.brand ? 'cp-tile cp-tile--brand' : 'cp-tile'}
              onClick={() => {
                setNotice(null)
                setFlow({ kind: 'picker', mode: t.mode })
              }}
            >
              <span className="cp-tile__box" aria-hidden="true">
                <Icon name={t.icon} size={30} />
              </span>
              <span className="cp-tile__label">{copy[t.label]}</span>
            </button>
          ))}
        </div>
      </section>

      {flow.kind === 'picker' && (
        <MemberPickerDialog mode={flow.mode} onClose={closeFlow} onSchedule={onSchedule} onLink={onLink} />
      )}
      {flow.kind === 'schedule' && (
        <ScheduleCallDialog
          conversation={flow.conversation}
          onClose={closeFlow}
          onChangeConversation={() => setFlow({ kind: 'picker', mode: 'schedule' })}
          onScheduled={(chatName) => {
            setFlow({ kind: 'none' })
            setNotice(copy.scheduled(chatName))
          }}
        />
      )}
      {flow.kind === 'link' && <CallLinkDialog conversation={flow.conversation} onClose={closeFlow} />}

      {cancelling && (
        <Dialog
          title={copy.cancelConfirmTitle}
          onClose={closeCancel}
          footer={
            <>
              <button type="button" className="btn" onClick={closeCancel}>
                {copy.keep}
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={cancel.isPending}
                onClick={() =>
                  cancel.mutate(cancelling.id, {
                    onSuccess: () => setCancelling(null),
                  })
                }
              >
                {copy.cancelConfirm}
              </button>
            </>
          }
        >
          <p>{copy.cancelConfirmBody(name(conversations.byId.get(cancelling.conversationId), upcomingName(cancelling)))}</p>
          {cancel.error ? (
            <p className="field__error" role="alert">
              {cancel.error instanceof ApiError ? cancel.error.localized(locale) : copy.cannotCall}
            </p>
          ) : null}
        </Dialog>
      )}
    </div>
  )
}
