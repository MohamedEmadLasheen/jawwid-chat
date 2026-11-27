import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { ACADEMY_ZONE, clock12In, dayMonthIn, isoToAcademyWallClock, weekdayIn } from '@/core/time/academyTime'
import { ApiError } from '@/core/api/errors'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { Dialog } from '@/shared/components/Dialog'
import { Icon, type IconName } from '@/shared/components/Icon'
import { Menu } from '@/shared/components/Menu'
import { PageHeader } from '@/shared/components/PageHeader'
import { RowActions } from '@/shared/components/RowActions'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States'
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
  const open = call.state !== 'cancelled' && isJoinable(call.joinableFrom, call.joinableUntil, now)
  // The server's state, corrected by the clock it told us to use.
  const state: ScheduledCallState = call.state === 'cancelled' ? 'cancelled' : open ? 'open' : call.state

  return (
    <li className={open ? 'cp-up cp-up--open' : 'cp-up'} data-testid="upcoming-row">
      {/* The hour first: it is what a scheduled call is read for. */}
      <time className="cp-up__time" dateTime={call.startsAt} title={dateTime(call.startsAt)}>
        <bdi>{clock12In(call.startsAt, ACADEMY_ZONE, locale)}</bdi>
      </time>
      <span className="cp-row__body">
        <span className="cp-row__name" dir="auto">{name}</span>
        <span className="cp-row__badges">
          {call.kind === 'link' && <Badge tone="neutral">{copy.linkBadge}</Badge>}
          <StateBadge state={state} />
        </span>
      </span>
      <RowActions
        label={copy.rowMenu(name)}
        primary={
          open ? (
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
          ) : undefined
        }
        more={
          call.canCancel && call.state !== 'cancelled'
            ? [{ key: 'cancel', label: copy.cancelCall, icon: 'calendarX', danger: true, onSelect: () => onCancel(call) }]
            : []
        }
      />
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
    <li className={missed ? 'cp-recent cp-recent--missed' : 'cp-recent'} data-testid="recent-row" data-direction={direction} data-outcome={row.outcome ?? ''}>
      <span className="cp-recent__dir" title={direction === 'outgoing' ? copy.outgoing : copy.incoming}>
        <Icon name={direction === 'outgoing' ? 'callOutgoing' : 'callIncoming'} size={18} />
      </span>
      <span className="cp-row__body">
        <span className="cp-recent__who">
          <span className={missed ? 'cp-row__name cp-row__name--missed' : 'cp-row__name'}>{name}</span>
          {isTrialGroup(conversation) && <TrialBadge />}
        </span>
        <span className="cp-recent__facts">
          <span>{direction === 'outgoing' ? copy.outgoing : copy.incoming}</span>
          <Badge tone={missed ? 'danger' : row.outcome === 'answered' ? 'ok' : row.outcome ? 'neutral' : 'info'}>
            <span>{status}</span>
          </Badge>
          {row.endReason === 'connection_lost' ? <span className="cp-recent__lost">· {copy.connectionLost}</span> : null}
        </span>
      </span>
      <span className="cp-recent__len">{row.durationSeconds ? <bdi>{copy.duration(row.durationSeconds)}</bdi> : null}</span>
      <time className="cp-row__time" dateTime={row.startedAt} title={dateTime(row.startedAt)}>
        {listTime(row.startedAt, locale)}
      </time>
      <RowActions
        label={copy.rowMenu(name)}
        primary={
          conversation ? (
            <button
              type="button"
              className="btn btn--sm cp-row__call"
              data-cp-item
              disabled={!actions.available || actions.busy}
              aria-label={copy.callTo(name)}
              title={copy.callTo(name)}
              onClick={() => void actions.startCall(conversation)}
            >
              <Icon name="phone" size={16} />
              {copy.colCall}
            </button>
          ) : undefined
        }
      />
    </li>
  )
}

/* ------------------------------------------------------------------- page */

/** The page's other ways to start: behind "⋯" beside the two stated actions. */
const MORE: Array<{ mode: PickerMode; icon: IconName; label: 'newLink' | 'selectMember' }> = [
  { mode: 'link', icon: 'link', label: 'newLink' },
  { mode: 'select', icon: 'users', label: 'selectMember' },
]

/**
 * THE CALLS PAGE (PD-13), for operators at /calls and the super admin at
 * /admin/calls. Two sheets side by side: what is scheduled, as an agenda by day
 * with its hour first (and the pinned chats to ring under it); and the account's
 * history as rows to call back. Starting a call is the masthead's one action;
 * scheduling is beside it and the rest behind "⋯". Voice only. Every list is the
 * server's answer for THIS account; every action is decided again by the server,
 * and the call itself runs in the one existing call window.
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

  const pick = (mode: PickerMode) => {
    setNotice(null)
    setFlow({ kind: 'picker', mode })
  }
  const today = isoToAcademyWallClock(new Date(now).toISOString()).date
  const tomorrow = isoToAcademyWallClock(new Date(now + 86_400_000).toISOString()).date
  // The agenda: scheduled calls under the academy day they fall on.
  const days = useMemo(() => {
    const out: Array<{ day: string; at: string; calls: ScheduledCall[] }> = []
    for (const c of upcomingRows) {
      const day = isoToAcademyWallClock(c.startsAt).date
      const last = out[out.length - 1]
      if (last && last.day === day) last.calls.push(c)
      else out.push({ day, at: c.startsAt, calls: [c] })
    }
    return out
  }, [upcomingRows])
  const dayName = (day: string, at: string) =>
    day === today ? copy.today : day === tomorrow ? copy.tomorrow : `${weekdayIn(at, ACADEMY_ZONE, locale)} ${dayMonthIn(at, ACADEMY_ZONE, locale)}`
  const openNow = (upcoming.data ?? []).filter((c) => c.state !== 'cancelled' && isJoinable(c.joinableFrom, c.joinableUntil, now)).length

  const upcomingSection = (
    <section className="sheet cp-section" aria-labelledby="cp-upcoming">
      <div className="sheet__head">
        <h2 className="sheet__title" id="cp-upcoming">
          {copy.upcoming}
        </h2>
      </div>
      {upcoming.isLoading ? (
        <LoadingState compact />
      ) : upcoming.error ? (
        <ErrorState compact error={upcoming.error} onRetry={() => void upcoming.refetch()} />
      ) : upcomingRows.length === 0 ? (
        searching ? (
          <EmptyState compact title={copy.noMatches} />
        ) : (
          <EmptyState compact title={copy.noUpcoming} hint={copy.noUpcomingHint} />
        )
      ) : (
        days.map((d) => (
          <div key={d.day} className="cp-day">
            <h3 className="cp-day__head">{dayName(d.day, d.at)}</h3>
            <ul className="cp-list" onKeyDown={onListKeyDown}>
              {d.calls.map((c) => (
                <UpcomingRow key={c.id} call={c} name={upcomingName(c)} now={now} onCancel={setCancelling} />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  )

  const favoritesSection = (
    <section className="sheet cp-section" aria-labelledby="cp-favorites">
      <div className="sheet__head">
        <h2 className="sheet__title" id="cp-favorites">
          {copy.favorites}
        </h2>
      </div>
      {conversations.isLoading ? (
        <LoadingState compact />
      ) : conversations.error ? (
        <ErrorState compact error={conversations.error} onRetry={() => void conversations.refetch()} />
      ) : favorites.length === 0 ? (
        searching ? (
          <EmptyState compact title={copy.noMatches} />
        ) : (
          <EmptyState compact title={copy.noFavorites} hint={copy.noFavoritesHint} />
        )
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
                <RowActions
                  label={copy.rowMenu(n)}
                  primary={
                    <button
                      type="button"
                      className="btn btn--sm cp-row__call"
                      data-cp-item
                      disabled={!actions.available || actions.busy}
                      aria-label={copy.callTo(n)}
                      title={copy.callTo(n)}
                      onClick={() => void actions.startCall(c)}
                    >
                      <Icon name="phone" size={16} />
                      {copy.colCall}
                    </button>
                  }
                />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )

  const recentSection = (
    <section className="sheet cp-section" aria-labelledby="cp-recent">
      <div className="sheet__head">
        <h2 className="sheet__title" id="cp-recent">
          {copy.recent}
        </h2>
      </div>
      {history.isLoading ? (
        <LoadingState compact />
      ) : history.error ? (
        <ErrorState compact error={history.error} onRetry={() => void history.refetch()} />
      ) : recentRows.length === 0 ? (
        searching ? (
          <EmptyState compact title={copy.noMatches} />
        ) : (
          <EmptyState compact title={copy.noRecent} hint={copy.noRecentHint} />
        )
      ) : (
        <ul className="cp-list" onKeyDown={onListKeyDown}>
          {recentRows.map((r) => (
            <RecentRow key={r.row.id} row={r.row} name={r.name} conversation={r.conversation} selfId={selfId} />
          ))}
        </ul>
      )}
      {history.hasNextPage && (
        <div className="cp-more">
          <button type="button" className="btn btn--sm" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
            {copy.loadMore}
          </button>
        </div>
      )}
    </section>
  )

  return (
    <div className="page cp-page">
      <div className="page__inner">
        <PageHeader
          title={copy.title}
          subtitle={copy.subtitle}
          figures={
            upcoming.data
              ? [
                  { key: 'open', label: copy.stateOpen, value: String(openNow), tone: openNow > 0 ? 'key' : 'quiet' },
                  { key: 'scheduled', label: copy.figScheduled, value: String(upcoming.data.filter((c) => c.state !== 'cancelled').length) },
                ]
              : undefined
          }
          actions={
            <section className="cp-actions" aria-label={copy.actions}>
              <button type="button" className="btn btn--primary cp-action" onClick={() => pick('call')}>
                <Icon name="phone" size={16} />
                {copy.startCall}
              </button>
              <button type="button" className="btn cp-action" onClick={() => pick('schedule')}>
                <Icon name="calendarPlus" size={16} />
                {copy.scheduleCall}
              </button>
              <Menu
                label={copy.moreActions}
                triggerClassName="btn btn--icon"
                items={MORE.map((m) => ({ key: m.mode, label: copy[m.label], icon: m.icon, onSelect: () => pick(m.mode) }))}
              />
            </section>
          }
        />

        {notice && (
          <div className="cp-notice" role="status">
            <span>{notice}</span>
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              aria-label={copy.dismiss}
              title={copy.dismiss}
              onClick={() => setNotice(null)}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}

        <div className="cp-cols">
          <div className="cp-cols__start">
            {upcomingSection}
            {favoritesSection}
          </div>
          <div className="cp-cols__end">
            <div className="cp-search">
              <SearchField value={query} onChange={setQuery} label={copy.search} clearLabel={copy.clearSearch} />
            </div>
            {recentSection}
          </div>
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
