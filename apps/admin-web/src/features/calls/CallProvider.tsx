import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/core/auth/SessionProvider'
import { useRealtime } from '@/core/realtime/RealtimeProvider'
import { callApi, callKeys } from './callApi'
import { CallController, IDLE_CALL, type CallApi, type CallServerEvent, type CallState } from './callController'
import { createLiveKitMedia, type CallMediaFactory } from './callMedia'

const CallContext = createContext<CallController | null>(null)

const CALL_EVENTS = ['call.incoming', 'call.accepted', 'call.declined', 'call.ended'] as const

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

/**
 * Reduce a raw socket payload to a typed event, or nothing. The server is
 * trusted for its own fields, but a malformed frame must not reach the
 * controller as a half-filled call.
 */
export function toServerEvent(event: (typeof CALL_EVENTS)[number], raw: unknown): CallServerEvent | null {
  const p = (raw ?? {}) as Record<string, unknown>
  const callId = str(p.callId)
  if (!callId) return null
  switch (event) {
    case 'call.incoming': {
      const conversationId = str(p.conversationId)
      if (!conversationId) return null
      return {
        event,
        payload: { callId, conversationId, type: str(p.type) ?? 'direct', initiatorName: str(p.initiatorName) ?? '' },
      }
    }
    case 'call.ended':
      return {
        event,
        payload: {
          callId,
          outcome: str(p.outcome) ?? '',
          durationSeconds: typeof p.durationSeconds === 'number' ? p.durationSeconds : null,
        },
      }
    default:
      return { event, payload: { callId } }
  }
}

/**
 * ONE call controller per signed-in admin. Keyed on the staff id, so signing
 * out or switching user disposes it -- which drops the media room -- before a
 * new one exists: no call outlives the principal it belongs to.
 *
 * Call events arrive in this admin's OWN actor room (the server routes call
 * events to their participants, W8-W0b), on the session's one socket; nothing
 * here subscribes to a conversation to hear a call ring.
 */
export function CallProvider({
  children,
  api = callApi,
  createMedia = createLiveKitMedia,
}: {
  children: ReactNode
  api?: CallApi
  createMedia?: CallMediaFactory
}) {
  const { staff } = useSession()
  const { socket } = useRealtime()
  const queryClient = useQueryClient()
  const staffId = staff?.id ?? null

  const controller = useMemo(
    () => (staffId ? new CallController(api, createMedia) : null),
    // A new principal is a new controller; api and createMedia are fixed per app.
    [staffId],
  )
  useEffect(() => () => controller?.dispose(), [controller])

  useEffect(() => {
    if (!socket || !controller) return
    const handlers = CALL_EVENTS.map((event) => {
      const handler = (raw: unknown) => {
        const e = toServerEvent(event, raw)
        if (!e) return
        controller.onServerEvent(e)
        // History and capability are re-read, never patched from a payload.
        const conversationId = str((raw as Record<string, unknown> | null)?.conversationId)
        if (conversationId && event !== 'call.incoming') {
          void queryClient.invalidateQueries({ queryKey: callKeys.history(conversationId) })
        }
      }
      socket.on(event, handler)
      return [event, handler] as const
    })
    return () => {
      for (const [event, handler] of handlers) socket.off(event, handler)
    }
  }, [socket, controller, queryClient])

  return <CallContext.Provider value={controller}>{children}</CallContext.Provider>
}

const noopSubscribe = () => () => undefined
const idle = () => IDLE_CALL

/** The current call, and the controller to act on it (null while signed out). */
export function useCall(): { state: CallState; controller: CallController | null } {
  const controller = useContext(CallContext)
  const state = useSyncExternalStore(controller?.subscribe ?? noopSubscribe, controller?.getSnapshot ?? idle)
  return { state, controller }
}
