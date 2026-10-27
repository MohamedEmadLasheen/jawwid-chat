import { useCallback, useEffect, useRef, useState } from 'react'
import { useRealtime } from '@/core/realtime/RealtimeProvider'

/** How often a typist says "still typing" (the server re-announces at most every 5 s). */
export const TYPING_PING_MS = 3_000
/** A pause this long is a stop. */
export const TYPING_IDLE_MS = 5_000
/** An indicator not heard about for this long is dropped (realtime.typing_ttl_seconds). */
export const TYPING_SHOW_MS = 8_000

/**
 * PD-37: tell the conversation this person is typing. Throttled here and
 * debounced again on the server; the server decides whether the typist may
 * type at all (a seated member) and who hears it (seated members only).
 *
 * `typed(text)` on every change of the draft; `stop()` on send. Leaving the
 * chat, an empty draft or a pause all stop.
 */
export function useTypingSignal(conversationId: string): { typed: (text: string) => void; stop: () => void } {
  const { socket } = useRealtime()
  const lastPing = useRef(0)
  const active = useRef(false)
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const stop = useCallback(() => {
    clearTimeout(idle.current)
    if (!active.current) return
    active.current = false
    lastPing.current = 0
    socket?.emit('typing.stop', { conversationId })
  }, [socket, conversationId])

  const typed = useCallback(
    (text: string) => {
      if (!socket) return
      if (text.trim() === '') {
        stop()
        return
      }
      const now = Date.now()
      if (now - lastPing.current >= TYPING_PING_MS) {
        socket.emit('typing.start', { conversationId })
        lastPing.current = now
        active.current = true
      }
      clearTimeout(idle.current)
      idle.current = setTimeout(stop, TYPING_IDLE_MS)
    },
    [socket, conversationId, stop],
  )

  // Switching chats or leaving the page is a stop.
  useEffect(() => stop, [stop])
  return { typed, stop }
}

interface TypingPayload {
  conversationId?: unknown
  actorId?: unknown
  displayName?: unknown
}

/**
 * PD-37: who is typing in this conversation right now, by display name. The
 * server sends this only to seated members; a viewer reading without a seat
 * simply never hears any. An indicator lapses after TYPING_SHOW_MS without
 * news, so a lost stop cannot leave it on screen.
 */
export function useTypers(conversationId: string, selfId: string | undefined): string[] {
  const { socket } = useRealtime()
  const [typers, setTypers] = useState<Map<string, { name: string; until: number }>>(() => new Map())

  useEffect(() => {
    setTypers(new Map())
    if (!socket) return
    const mine = (p: TypingPayload | undefined) =>
      p?.conversationId === conversationId && typeof p.actorId === 'string' && p.actorId !== selfId
    const onStart = (p: TypingPayload | undefined) => {
      if (!mine(p)) return
      setTypers((all) => {
        const next = new Map(all)
        next.set(p!.actorId as string, {
          name: typeof p!.displayName === 'string' && p!.displayName ? p!.displayName : '…',
          until: Date.now() + TYPING_SHOW_MS,
        })
        return next
      })
    }
    const onStop = (p: TypingPayload | undefined) => {
      if (!mine(p)) return
      setTypers((all) => {
        if (!all.has(p!.actorId as string)) return all
        const next = new Map(all)
        next.delete(p!.actorId as string)
        return next
      })
    }
    socket.on('typing.started', onStart)
    socket.on('typing.stopped', onStop)
    return () => {
      socket.off('typing.started', onStart)
      socket.off('typing.stopped', onStop)
    }
  }, [socket, conversationId, selfId])

  // Lapse indicators nobody renewed.
  useEffect(() => {
    if (typers.size === 0) return
    const soonest = Math.min(...[...typers.values()].map((t) => t.until))
    const timer = setTimeout(() => {
      const now = Date.now()
      setTypers((all) => new Map([...all].filter(([, t]) => t.until > now)))
    }, Math.max(0, soonest - Date.now()) + 10)
    return () => clearTimeout(timer)
  }, [typers])

  return [...typers.values()].map((t) => t.name)
}
