import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { qk } from '@/core/api/queryKeys'
import { useSession } from '@/core/auth/SessionProvider'
import { tokenStore } from '@/core/auth/tokens'
import { refreshSession } from '@/core/api/client'
import type { ConnectionState, ServerEvents } from './events'

const REALTIME_URL = import.meta.env?.VITE_REALTIME_URL ?? ''

interface RealtimeValue {
  state: ConnectionState
  /** True once a connection has been established and then lost. */
  hasEverConnected: boolean
  /**
   * The session's one socket, for features that subscribe to conversations
   * (the chat workspace). Null while signed out. Features add and remove their
   * own listeners on it; they never open a second connection.
   */
  socket: Socket | null
}

const RealtimeContext = createContext<RealtimeValue>({
  state: 'disconnected',
  hasEverConnected: false,
  socket: null,
})

/**
 * Maps each server event to the queries it invalidates.
 *
 * Note what is deliberately absent: no handler writes a bucket, attention
 * reason, workload score or on-duty assignment into the cache. Those are
 * computed server-side; we refetch them.
 */
function registerHandlers(socket: Socket, qc: QueryClient): void {
  const on = <K extends keyof ServerEvents>(
    event: K,
    handler: (payload: ServerEvents[K]) => void,
  ) => socket.on(event as string, handler as (p: unknown) => void)

  on('task.updated', () => {
    void qc.invalidateQueries({ queryKey: qk.tasksAll })
  })

  on('coverage.changed', () => {
    void qc.invalidateQueries({ queryKey: qk.coverageAll })
  })
}

/** PD-37: well inside the server's 45 s presence TTL. */
const PRESENCE_HEARTBEAT_MS = 30_000

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useSession()
  const queryClient = useQueryClient()
  const [state, setState] = useState<ConnectionState>('disconnected')
  const [current, setCurrent] = useState<Socket | null>(null)
  const hasEverConnected = useRef(false)

  useEffect(() => {
    if (!isAuthenticated) {
      setState('disconnected')
      return
    }

    setState('connecting')
    // The API's contract (API-CONTRACT §1): the DEFAULT namespace, and the
    // bearer access token in the handshake `auth`. It sets no cookie, so the
    // old `/staff` namespace with credentials could never have connected.
    //
    // `auth` is a function so every (re)connect presents the CURRENT access
    // token: it rotates every 15 minutes, and a reconnect that replayed the
    // first one would be refused. The server derives identity from the token
    // alone; the client never names an actor or a room.
    const socket = io(REALTIME_URL || undefined, {
      transports: ['websocket'],
      auth: (cb: (data: { token: string | null }) => void) => cb({ token: tokenStore.access() }),
    })
    setCurrent(socket)
    let renewedOnce = false

    socket.on('connect', () => {
      renewedOnce = false
      hasEverConnected.current = true
      setState('connected')
      // A reconnect means we may have missed events while offline; treat every
      // cached operational query as stale rather than trusting a gap.
      void queryClient.invalidateQueries()
    })
    socket.on('disconnect', (reason: string) => {
      setState('disconnected')
      // The server closes a socket whose token it refuses (expired, revoked).
      // socket.io does not retry that on its own. Rotate the session once --
      // through the same single-flight refresh every HTTP 401 uses -- and try
      // again; a second refusal in a row stays down rather than looping.
      if (reason === 'io server disconnect' && !renewedOnce) {
        renewedOnce = true
        void refreshSession().then((ok) => {
          if (ok) socket.connect()
        })
      }
    })
    socket.on('connect_error', () => setState('disconnected'))

    registerHandlers(socket, queryClient)

    // PD-37: keep this session counted as online (realtime.presence_ttl_seconds
    // is 45); who may SEE it is the server's PresencePolicy, never this client.
    const heartbeat = setInterval(() => {
      if (socket.connected) socket.emit('presence.heartbeat')
    }, PRESENCE_HEARTBEAT_MS)

    return () => {
      clearInterval(heartbeat)
      setCurrent(null)
      socket.removeAllListeners()
      socket.disconnect()
    }
  }, [isAuthenticated, queryClient])

  const value = useMemo(
    () => ({ state, hasEverConnected: hasEverConnected.current, socket: current }),
    [state, current],
  )

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

export function useRealtime(): RealtimeValue {
  return useContext(RealtimeContext)
}
