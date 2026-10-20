import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Socket } from 'socket.io-client'
import { useRealtime } from '@/core/realtime/RealtimeProvider'
import { chatKeys } from './chatApi'

/** Events that change a message the thread may be showing. */
const MESSAGE_EVENTS = [
  'message.created',
  'message.deleted',
  // An author edited a message: the event names it, the thread re-reads it.
  'message.updated',
  'reaction.added',
  'reaction.removed',
  'approval.decided',
  // Staff only (the server routes it to staff actor rooms): a held message
  // now waits for a decision.
  'approval.requested',
] as const

/** Events that change the list (activity, unread, membership). */
const LIST_EVENTS = [
  'conversation.updated',
  'conversation.membership_changed',
  'conversation.added',
  'conversation.access_revoked',
] as const

const SUBSCRIBE_ACK_MS = 8_000
const UNKNOWN_ACTOR_ATTEMPTS = 4
const UNKNOWN_ACTOR_DELAY_MS = 250

/**
 * Ask the server to put this socket in a conversation's room.
 *
 * The client names a conversation, never a room, and the server runs the same
 * read check the REST path runs (staff scope included) before it joins. A
 * refusal is the server's verdict and is NOT retried -- except
 * `COMM.UNKNOWN_ACTOR`, which is the handshake race: the socket's `connect`
 * fires before the server has finished authenticating it.
 */
export async function subscribeConversation(
  socket: Socket,
  conversationId: string,
  isCancelled: () => boolean = () => false,
): Promise<{ ok: boolean; code?: string }> {
  for (let attempt = 1; ; attempt++) {
    let answer: { ok: boolean; code?: string }
    try {
      answer = await socket
        .timeout(SUBSCRIBE_ACK_MS)
        .emitWithAck('conversation.subscribe', { conversationId })
    } catch {
      answer = { ok: false, code: 'COMM.SUBSCRIBE_TIMEOUT' }
    }
    if (answer?.ok || answer?.code !== 'COMM.UNKNOWN_ACTOR') return answer ?? { ok: false }
    if (attempt >= UNKNOWN_ACTOR_ATTEMPTS || isCancelled()) return answer
    await new Promise((r) => setTimeout(r, UNKNOWN_ACTOR_DELAY_MS * attempt))
    if (isCancelled()) return answer
  }
}

/**
 * Live chat for the workspace that is on screen.
 *
 * ONE SOCKET. It uses the session's connection from RealtimeProvider and adds
 * its own listeners to it, removing exactly those on unmount -- so remounting
 * the page, or switching conversations, can never stack a second handler.
 *
 * SUBSCRIPTIONS FOLLOW THE LIST. Every conversation the server listed for this
 * admin is subscribed (so a message in a conversation that is not open still
 * moves the list), diffed rather than torn down and rebuilt when the list
 * changes, and re-requested after every reconnect because rooms do not survive
 * one. The list is the server's answer to "what may I read", so this can never
 * ask for more than that, and the server re-checks each request anyway.
 *
 * SIGNALS, NOT STATE. Nothing is written from an event payload -- a
 * `message.created` carries no body. Events invalidate queries and the data is
 * re-read through the authorized REST routes, which also makes a duplicated or
 * replayed event harmless.
 */
export function useChatRealtime(conversationIds: readonly string[]): void {
  const { socket } = useRealtime()
  const queryClient = useQueryClient()
  const subscribed = useRef(new Set<string>())
  const wantedKey = [...new Set(conversationIds)].sort().join(',')

  // Event handlers: registered once per socket, removed by reference.
  useEffect(() => {
    if (!socket) return
    let listTimer: ReturnType<typeof setTimeout> | undefined
    const refreshList = () => {
      clearTimeout(listTimer)
      // A burst (a busy group, a reconnect) becomes one list read.
      listTimer = setTimeout(() => void queryClient.invalidateQueries({ queryKey: chatKeys.list }), 250)
    }
    const onMessage = (payload: { conversationId?: unknown } | undefined) => {
      const id = typeof payload?.conversationId === 'string' ? payload.conversationId : null
      if (id) {
        void queryClient.invalidateQueries({ queryKey: chatKeys.messages(id) })
        void queryClient.invalidateQueries({ queryKey: chatKeys.approvals(id) })
      }
      refreshList()
    }
    const onList = (payload: { conversationId?: unknown } | undefined) => {
      const id = typeof payload?.conversationId === 'string' ? payload.conversationId : null
      if (id) {
        void queryClient.invalidateQueries({ queryKey: chatKeys.conversation(id) })
        // A pin or unpin arrives as conversation.updated: the pinned bar and
        // the messages' pinned flags re-read too.
        void queryClient.invalidateQueries({ queryKey: chatKeys.pins(id) })
        void queryClient.invalidateQueries({ queryKey: chatKeys.messages(id) })
      }
      refreshList()
    }

    for (const event of MESSAGE_EVENTS) socket.on(event, onMessage)
    for (const event of LIST_EVENTS) socket.on(event, onList)
    return () => {
      clearTimeout(listTimer)
      for (const event of MESSAGE_EVENTS) socket.off(event, onMessage)
      for (const event of LIST_EVENTS) socket.off(event, onList)
    }
  }, [socket, queryClient])

  // Rooms do not survive a reconnect: re-request everything held.
  useEffect(() => {
    if (!socket) return
    const held = subscribed.current
    const resubscribe = () => {
      for (const id of held) void subscribeConversation(socket, id)
    }
    socket.on('connect', resubscribe)
    return () => {
      socket.off('connect', resubscribe)
      for (const id of held) socket.emit('conversation.unsubscribe', { conversationId: id })
      held.clear()
    }
  }, [socket])

  // Follow the list: subscribe what is new, unsubscribe what left.
  useEffect(() => {
    if (!socket) return
    const wanted = new Set(wantedKey ? wantedKey.split(',') : [])
    const held = subscribed.current
    for (const id of [...held]) {
      if (!wanted.has(id)) {
        held.delete(id)
        socket.emit('conversation.unsubscribe', { conversationId: id })
      }
    }
    for (const id of wanted) {
      if (held.has(id)) continue
      held.add(id)
      if (socket.connected) void subscribeConversation(socket, id, () => !held.has(id))
    }
  }, [socket, wantedKey])
}
