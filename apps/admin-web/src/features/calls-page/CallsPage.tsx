import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { ACADEMY_ZONE, clock12In, dayMonthIn, weekdayIn } from '@/core/time/academyTime'
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
import { TrialBadge, isTrialGroup } from '@/shared/components/TrialBadge'

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
  const { dateTime, locale } = useI18n()
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
    <li className={open ? 'cp-up cp-up--open' : 'cp-up'} data-testid="upcoming-row">
      {/* The hour first: it is what a scheduled call is read for. */}
      <time className="cp-up__when" dateTime={call.startsAt} title={dateTime(call.startsAt)}>
        <bdi className="cp-up__time">{clock12In(call.startsAt, ACADEMY_ZONE, locale)}</bdi>
        <span className="cp-up__day">
          {weekdayIn(call.startsAt, ACADEMY_ZONE, locale)} {dayMonthIn(call.startsAt, ACADEMY_ZONE, locale)}
        </span>
      </time>
      <span className="cp-row__body">
        <span className="cp-row__name" dir="auto">{name}</span>
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
    <tr className="cp-recent" data-testid="recent-row" data-direction={direction} data-outcome={row.outcome ?? ''}>
      <th scope="row" className="cp-recent__who">
        <span className="cp-recent__name">
          <Avatar name={name} seed={row.conversationId} size="sm" />
          <span className={missed ? 'cp-row__name cp-row__name--missed' : 'cp-row__name'}>{name}</span>
          {isTrialGroup(conversation) && <TrialBadge />}
        </span>
      </th>
      <td className="cp-recent__dir">
        <Icon name={direction === 'outgoing' ? 'callOutgoing' : 'callIncoming'} size={14} />
        <span>{direction === 'outgoing' ? copy.outgoing : copy.incoming}</span>
      </td>
      <td className="cp-recent__status">
        <Badge tone={missed ? 'danger' : row.outcome === 'answered' ? 'ok' : row.outcome ? 'neutral' : 'info'}>
          <span>{status}</span>
        </Badge>
        {row.endReason === 'connection_lost' ? <span className="cp-recent__lost">· {copy.connectionLost}</span> : null}
      </td>
      <td className="cp-recent__len num">{row.durationSeconds ? <span>{copy.duration(row.durationSeconds)}</span> : null}</td>
      <td className="cp-recent__when">
        <time className="cp-row__time" dateTime={row.startedAt} title={dateTime(row.startedAt)}>
          {listTime(row.startedAt, locale)}
        </time>
      </td>
      <td className="cp-recent__call">
        {conversation && (
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm cp-row__call"
            data-cp-item
            disabled={!actions.available || actions.busy}
            aria-label={copy.callTo(name)}
            onClick={() => void actions.startCall(conversation)}
          >
            <Icon name="phone" size={16} />
          </button>
        )}
      </td>
    </tr>
  )
}

/* ------------------------------------------------------------------- page */

const ACTIONS: Array<{ mode: PickerMode; icon: IconName; label: 'startCall' | 'newLink' | 'selectMember' | 'scheduleCall'; primary?: boolean }> = [
  { mode: 'call', icon: 'phone', label: 'startCall', primary: true },
  { mode: 'link', icon: 'link', label: 'newLink' },
  { mode: 'select', icon: 'users', label: 'selectMember' },
  { mode: 'schedule', icon: 'calendarPlus', label: 'scheduleCall' },
]

/**
 * THE CALLS PAGE (PD-13), for operators at /calls and the super admin at
 * /admin/calls. Four actions beside the title; what is scheduled, with its
 * hour first; the account's history as a ruled table; pinned chats to ring
 * in one click. Voice only. Every list is the server's answer for THIS account; every action is
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

  const upcomingSection = (
    <section className="cp-section" aria-labelledby="cp-upcoming">
      <h2 className="section-label cp-section__title" id="cp-upcoming">
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
  )

  const favoritesSection = (
    <section className="cp-section" aria-labelledby="cp-favorites">
      <h2 className="section-label cp-section__title" id="cp-favorites">
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
                  <span className="cp-row__name">
                    {n} {isTrialGroup(c) && <TrialBadge />}
                  </span>
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
                    <Icon name="phone" size={16} />
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )

  const recentSection = (
    <section className="cp-section" aria-labelledby="cp-recent">
      <h2 className="section-label cp-section__title" id="cp-recent">
        {copy.recent}
      </h2>
      {history.isLoading ? (
        <LoadingState compact />
      ) : history.error ? (
        <ErrorState compact error={history.error} onRetry={() => void history.refetch()} />
      ) : recentRows.length === 0 ? (
        <p className="cp-empty">{searching ? copy.noMatches : copy.noRecent}</p>
      ) : (
        <table className="table cp-table">
          <thead>
            <tr>
              <th scope="col">{copy.colName}</th>
              <th scope="col">{copy.colDirection}</th>
              <th scope="col">{copy.colStatus}</th>
              <th scope="col" className="num">{copy.colDuration}</th>
              <th scope="col">{copy.colWhen}</th>
              <th scope="col"><span className="sr-only">{copy.colCall}</span></th>
            </tr>
          </thead>
          <tbody onKeyDown={onListKeyDown}>
            {recentRows.map((r) => (
              <RecentRow key={r.row.id} row={r.row} name={r.name} conversation={r.conversation} selfId={selfId} />
            ))}
          </tbody>
        </table>
      )}
      {history.hasNextPage && (
        <button
          type="button"
          className="btn btn--sm cp-more"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {copy.loadMore}
        </button>
      )}
    </section>
  )

  return (
    <div className="page cp-page">
      <div className="page__inner">
        <header className="page-header cp-head">
          <div className="page-header__text">
            <h1 className="page-header__title" id="cp-title">
              {copy.title}
            </h1>
          </div>
          <section className="cp-actions" aria-label={copy.actions}>
            {ACTIONS.map((t) => (
              <button
                key={t.mode}
                type="button"
                className={t.primary ? 'btn btn--primary cp-action' : 'btn cp-action'}
                onClick={() => {
                  setNotice(null)
                  setFlow({ kind: 'picker', mode: t.mode })
                }}
              >
                <Icon name={t.icon} size={16} />
                {copy[t.label]}
              </button>
            ))}
          </section>
        </header>

        {notice && (
          <div className="cp-notice" role="status">
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

        <div className="cp-search">
          <SearchField value={query} onChange={setQuery} label={copy.search} clearLabel={copy.clearSearch} />
        </div>

        <div className="cp-cols">
          <div className="cp-cols__main">
            {upcomingSection}
            {recentSection}
          </div>
          <aside className="cp-cols__side">{favoritesSection}</aside>
        </div>
      </div>

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
