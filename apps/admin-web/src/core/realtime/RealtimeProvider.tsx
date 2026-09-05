import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { qk } from '@/core/api/queryKeys'
import { useSession } from '@/core/auth/SessionProvider'
import type { ConnectionState, ServerEvents } from './events'

const REALTIME_URL = import.meta.env?.VITE_REALTIME_URL ?? ''
const NAMESPACE = '/staff'

interface RealtimeValue {
  state: ConnectionState
  /** True once a connection has been established and then lost. */
  hasEverConnected: boolean
}

const RealtimeContext = createContext<RealtimeValue>({
  state: 'disconnected',
  hasEverConnected: false,
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

  on('family.updated', ({ family_id }) => {
    // The family may have moved between sections, so every section is stale.
    void qc.invalidateQueries({ queryKey: qk.inboxAll })
    void qc.invalidateQueries({ queryKey: qk.family(family_id) })
  })

  on('message.created', ({ family_id }) => {
    void qc.invalidateQueries({ queryKey: qk.familyMessages(family_id) })
    void qc.invalidateQueries({ queryKey: qk.inboxAll })
  })

  on('case.updated', ({ family_id }) => {
    void qc.invalidateQueries({ queryKey: qk.familyCases(family_id) })
    void qc.invalidateQueries({ queryKey: qk.family(family_id) })
    void qc.invalidateQueries({ queryKey: qk.inboxAll })
  })

  on('task.updated', ({ task }) => {
    void qc.invalidateQueries({ queryKey: qk.tasksAll })
    void qc.invalidateQueries({ queryKey: qk.family(task.family_id) })
    // Completing the last open task on a case reopens it server-side and moves
    // the family to TODAY, so the inbox is stale too (brief §8).
    void qc.invalidateQueries({ queryKey: qk.inboxAll })
  })

  on('handoff.created', () => {
    void qc.invalidateQueries({ queryKey: qk.awaySummary })
    void qc.invalidateQueries({ queryKey: qk.inboxAll })
  })

  on('coverage.changed', () => {
    void qc.invalidateQueries({ queryKey: qk.coverageAll })
    void qc.invalidateQueries({ queryKey: qk.duty })
    void qc.invalidateQueries({ queryKey: qk.inboxAll })
  })

  on('ownership.changed', ({ family_id }) => {
    void qc.invalidateQueries({ queryKey: qk.family(family_id) })
    void qc.invalidateQueries({ queryKey: qk.inboxAll })
    void qc.invalidateQueries({ queryKey: qk.dashboardAll })
  })

  on('unattended.changed', () => {
    void qc.invalidateQueries({ queryKey: qk.dashboardHeader })
    void qc.invalidateQueries({ queryKey: qk.unattended })
  })

  on('escalation.created', () => {
    void qc.invalidateQueries({ queryKey: qk.needsAction })
    void qc.invalidateQueries({ queryKey: qk.dashboardHeader })
  })

  on('presence.changed', () => {
    void qc.invalidateQueries({ queryKey: qk.teamNow })
  })

  on('shift.ending', () => {
    void qc.invalidateQueries({ queryKey: qk.shiftBanner })
  })
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useSession()
  const queryClient = useQueryClient()
  const [state, setState] = useState<ConnectionState>('disconnected')
  const hasEverConnected = useRef(false)

  useEffect(() => {
    if (!isAuthenticated) {
      setState('disconnected')
      return
    }

    setState('connecting')
    // The server subscribes this socket to only what this staff member may see.
    // The client never joins rooms of its own choosing (brief §12).
    const socket = io(`${REALTIME_URL}${NAMESPACE}`, {
      withCredentials: true,
      transports: ['websocket'],
    })

    socket.on('connect', () => {
      hasEverConnected.current = true
      setState('connected')
      // A reconnect means we may have missed events while offline; treat every
      // cached operational query as stale rather than trusting a gap.
      void queryClient.invalidateQueries()
    })
    socket.on('disconnect', () => setState('disconnected'))
    socket.on('connect_error', () => setState('disconnected'))

    registerHandlers(socket, queryClient)

    return () => {
      socket.removeAllListeners()
      socket.disconnect()
    }
  }, [isAuthenticated, queryClient])

  const value = useMemo(
    () => ({ state, hasEverConnected: hasEverConnected.current }),
    [state],
  )

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

export function useRealtime(): RealtimeValue {
  return useContext(RealtimeContext)
}
