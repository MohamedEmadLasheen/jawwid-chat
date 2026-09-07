import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { qk } from '@/core/api/queryKeys'
import { getAccessToken } from '@/core/api/client'
import { useSession } from '@/core/auth/SessionProvider'
import { ClientFrame, type ConnectionState, type ServerEvents } from './events'

const REALTIME_URL = (import.meta.env?.VITE_REALTIME_URL as string | undefined) ?? ''

interface RealtimeValue {
  state: ConnectionState
  /** True once a connection has been established and then lost. */
  hasEverConnected: boolean
  /**
   * Ask the server for a conversation's events.
   *
   * The client never joins a room by naming it: it names a CONVERSATION, and
   * the gateway runs the same `canRead` the REST path does before joining.
   * Returns the actors already typing there, so an indicator that started
   * before this tab opened the conversation is not invisible until the next
   * keystroke.
   */
  subscribe: (conversationId: string) => Promise<string[]>
  unsubscribe: (conversationId: string) => void
  setTyping: (conversationId: string, isTyping: boolean) => void
  /** Confirm this browser holds these messages, so DELIVERED is honest. */
  acknowledgeDelivered: (messageIds: string[]) => void
}

const noop = (): void => undefined

const RealtimeContext = createContext<RealtimeValue>({
  state: 'disconnected',
  hasEverConnected: false,
  subscribe: async () => [],
  unsubscribe: noop,
  setTyping: noop,
  acknowledgeDelivered: noop,
})

/**
 * Maps each server event to the queries it invalidates.
 *
 * Note what is deliberately absent: no handler writes a message body, a
 * receipt or a reaction into the cache from an event payload. Those are the
 * server's to decide per reader, and refetching is what keeps this console
 * from becoming a second, wrong source of truth.
 */
function registerHandlers(socket: Socket, qc: QueryClient): void {
  const on = <K extends keyof ServerEvents>(
    event: K,
    handler: (payload: ServerEvents[K]) => void,
  ) => socket.on(event as string, handler as (p: unknown) => void)

  /** Everything that changes a conversation's messages, and its queue row. */
  const messagesChanged = ({ conversationId }: { conversationId: string }) => {
    void qc.invalidateQueries({ queryKey: qk.conversationMessages(conversationId) })
    void qc.invalidateQueries({ queryKey: qk.conversation(conversationId) })
    void qc.invalidateQueries({ queryKey: qk.conversations })
  }

  on('message.created', messagesChanged)
  on('message.updated', messagesChanged)
  on('message.deleted', messagesChanged)
  on('message.receipt.updated', messagesChanged)
  on('reaction.added', messagesChanged)
  on('reaction.removed', messagesChanged)

  on('conversation.updated', ({ conversationId }) => {
    // The conversation may have moved between queue sections, so the list is
    // stale as well as the row.
    void qc.invalidateQueries({ queryKey: qk.conversation(conversationId) })
    void qc.invalidateQueries({ queryKey: qk.conversations })
    // Phase 6: this event carries `needsReply` and the resolved state, which is
    // exactly what the unanswered / open / closed KPIs count. A board that did
    // not refresh here would be stale in the one way that matters.
    void qc.invalidateQueries({ queryKey: qk.commandCenterAll })
  })

  on('conversation.membership_changed', ({ conversationId }) => {
    void qc.invalidateQueries({ queryKey: qk.conversation(conversationId) })
  })

  /**
   * Moderation events move the queue AND the Command Center's counters, so both
   * are invalidated. The two `*All` prefixes are used rather than the specific
   * keys because the queue's key carries its filter: a manager watching
   * "escalated only" must still see a new arrival land.
   *
   * Signals, not state, as everywhere else here: the payload deliberately
   * carries categories rather than the held text, and the console refetches
   * through the permission-checked read path.
   */
  const moderationChanged = ({ conversationId }: { conversationId: string }) => {
    messagesChanged({ conversationId })
    void qc.invalidateQueries({ queryKey: qk.moderationAll })
    void qc.invalidateQueries({ queryKey: qk.commandCenterAll })
  }

  on('approval.requested', moderationChanged)
  on('approval.decided', moderationChanged)
  on('moderation.escalated', moderationChanged)

  // Presence and typing are transient: they belong to component state, not to
  // the query cache, so they invalidate nothing. Components subscribe to them
  // through `useTypingIn` below.
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useSession()
  const queryClient = useQueryClient()
  const [state, setState] = useState<ConnectionState>('disconnected')
  const hasEverConnected = useRef(false)
  const socketRef = useRef<Socket | null>(null)
  /** Conversations this tab wants; re-sent on every connect. */
  const wanted = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!isAuthenticated) {
      setState('disconnected')
      return
    }

    const token = getAccessToken()
    if (!token) {
      setState('disconnected')
      return
    }

    setState('connecting')
    // The DEFAULT namespace and a bearer token in the handshake — the gateway
    // declares no namespace and reads `handshake.auth.token`. The previous
    // `/staff` namespace with `withCredentials` connected to nothing.
    const socket = io(REALTIME_URL, {
      transports: ['websocket'],
      auth: { token },
    })
    socketRef.current = socket

    socket.on('connect', () => {
      hasEverConnected.current = true
      setState('connected')
      // Server-side room membership does not survive a disconnect, so a client
      // that subscribed once and assumed it stayed subscribed goes silent
      // after the first drop without reporting anything.
      for (const conversationId of wanted.current) {
        socket.emit(ClientFrame.subscribe, { conversationId })
      }
      // A reconnect means events may have been missed while offline; treat
      // every cached query as stale rather than trusting a gap.
      void queryClient.invalidateQueries()
    })
    socket.on('disconnect', () => setState('disconnected'))
    socket.on('connect_error', () => setState('disconnected'))

    registerHandlers(socket, queryClient)
    attachTypingRelay(socket)

    return () => {
      socket.removeAllListeners()
      socket.disconnect()
      socketRef.current = null
    }
  }, [isAuthenticated, queryClient])

  const value = useMemo<RealtimeValue>(
    () => ({
      state,
      hasEverConnected: hasEverConnected.current,
      subscribe: async (conversationId: string) => {
        wanted.current.add(conversationId)
        const socket = socketRef.current
        if (!socket?.connected) return []
        try {
          const ack = (await socket
            .timeout(10_000)
            .emitWithAck(ClientFrame.subscribe, { conversationId })) as {
            ok?: boolean
            typing?: string[]
          }
          if (!ack?.ok) {
            // A refusal is a POLICY answer, not a transport fault: it will be
            // answered the same way forever, so stop asking rather than
            // re-subscribing on every reconnect.
            wanted.current.delete(conversationId)
            return []
          }
          return ack.typing ?? []
        } catch {
          // A socket that went away mid-frame. The reconnect handler
          // re-subscribes, so nothing is lost by returning empty here.
          return []
        }
      },
      unsubscribe: (conversationId: string) => {
        wanted.current.delete(conversationId)
        socketRef.current?.emit(ClientFrame.unsubscribe, { conversationId })
      },
      setTyping: (conversationId: string, isTyping: boolean) => {
        socketRef.current?.emit(
          isTyping ? ClientFrame.typingStart : ClientFrame.typingStop,
          { conversationId },
        )
      },
      acknowledgeDelivered: (messageIds: string[]) => {
        if (messageIds.length === 0) return
        socketRef.current?.emit(ClientFrame.delivered, { messageIds })
      },
    }),
    [state],
  )

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

export function useRealtime(): RealtimeValue {
  return useContext(RealtimeContext)
}

/**
 * Typing subscribers.
 *
 * A module-level fan-out rather than a socket listener per hook: the socket
 * lives in the provider and is replaced on every reconnect, so a hook that
 * attached to it directly would have to re-attach — and would miss whatever
 * arrived in between.
 */
type TypingListener = (payload: ServerEvents['typing.started'], isTyping: boolean) => void

const typingListeners = new Set<TypingListener>()

/** Attached once per socket by the provider, so every subscriber sees every frame. */
function attachTypingRelay(socket: Socket): void {
  socket.on('typing.started', (payload: ServerEvents['typing.started']) => {
    for (const listener of typingListeners) listener(payload, true)
  })
  socket.on('typing.stopped', (payload: ServerEvents['typing.stopped']) => {
    for (const listener of typingListeners) listener(payload, false)
  })
}

/**
 * Who is typing in one conversation.
 *
 * Held as component state rather than in the query cache: a typing indicator is
 * not a business record, and putting it in the cache would make it survive a
 * refetch it has no business surviving.
 *
 * Each name also expires LOCALLY. The server broadcasts a stop both on a stop
 * and on a disconnect, but neither reaches a tab whose own connection dropped
 * in between — and "…is typing" stuck on screen for somebody who left ten
 * minutes ago is worse than no indicator at all.
 */
export function useTypingIn(conversationId: string | null): string[] {
  const [names, setNames] = useState<Record<string, string>>({})

  useEffect(() => {
    setNames({})
    if (!conversationId) return

    const timers = new Map<string, ReturnType<typeof setTimeout>>()

    const drop = (actorId: string) => {
      timers.delete(actorId)
      setNames((current) => {
        if (!(actorId in current)) return current
        const next = { ...current }
        delete next[actorId]
        return next
      })
    }

    // A stable reference, so the cleanup below actually removes THIS listener.
    const listener: TypingListener = (payload, isTyping) => {
      if (payload.conversationId !== conversationId) return
      clearTimeout(timers.get(payload.actorId))
      if (!isTyping) {
        drop(payload.actorId)
        return
      }
      timers.set(payload.actorId, setTimeout(() => drop(payload.actorId), 10_000))
      setNames((current) => ({ ...current, [payload.actorId]: payload.displayName }))
    }

    typingListeners.add(listener)
    return () => {
      typingListeners.delete(listener)
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [conversationId])

  return Object.values(names)
}
