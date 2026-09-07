import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { conversationApi, messageApi } from '@/core/api/conversations'
import { qk } from '@/core/api/queryKeys'
import { useRealtime } from '@/core/realtime/RealtimeProvider'
import { byMostRecent, type Message } from '@/shared/types/conversation'

/** A client-generated idempotency key, minted once per composed message. */
export function newClientMessageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * The conversation queue.
 *
 * The list is RBAC-scoped by the server, so what comes back is already exactly
 * what this operator may see. Sectioning happens here because the sections are
 * plain predicates over fields the row already carries — `needsReply` — and not
 * an attention score the API does not compute. Nothing is filtered for
 * authorization reasons on this side.
 */
export function useConversationQueue() {
  const query = useQuery({
    queryKey: qk.conversations,
    queryFn: () => conversationApi.list(),
    staleTime: 10_000,
  })

  const conversations = useMemo(
    () => [...(query.data?.conversations ?? [])].sort(byMostRecent),
    [query.data],
  )

  return {
    ...query,
    conversations,
    needsReply: conversations.filter((c) => c.needsReply),
    waiting: conversations.filter((c) => !c.needsReply),
    totalUnread: conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0),
  }
}

export function useConversation(conversationId: string | null) {
  return useQuery({
    queryKey: qk.conversation(conversationId ?? ''),
    queryFn: () => conversationApi.get(conversationId!),
    enabled: Boolean(conversationId),
  })
}

/**
 * A conversation's messages, oldest first, paged backwards by `seq`.
 *
 * The API serves a backwards page NEWEST first and returns `nextBefore` only
 * when a full page came back — so its presence is exactly "there may be more".
 * The pages are flattened and re-sorted by `seq` here, because `seq` is the
 * server's authoritative order and arrival order is not: a realtime-triggered
 * refetch and a scroll-back page can land in either order.
 */
export function useConversationMessages(conversationId: string | null) {
  const query = useInfiniteQuery({
    queryKey: qk.conversationMessages(conversationId ?? ''),
    queryFn: ({ pageParam }) =>
      messageApi.page(conversationId!, pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled: Boolean(conversationId),
  })

  const messages = useMemo(() => {
    const byId = new Map<string, Message>()
    for (const page of query.data?.pages ?? []) {
      // Keyed by id, so a message that appears in two pages — which a page
      // boundary crossed by a new arrival will do — is one entry, not two.
      for (const message of page.messages) byId.set(message.id, message)
    }
    return [...byId.values()].sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
  }, [query.data])

  return { ...query, messages }
}

/**
 * Everything an operator can do to a conversation's messages.
 *
 * Every mutation invalidates rather than patching the cache: the server decides
 * what this operator may see of the result, and a locally-patched copy is a
 * second answer to that question.
 */
export function useMessageActions(conversationId: string) {
  const queryClient = useQueryClient()

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.conversationMessages(conversationId) })
    void queryClient.invalidateQueries({ queryKey: qk.conversation(conversationId) })
    void queryClient.invalidateQueries({ queryKey: qk.conversations })
  }, [conversationId, queryClient])

  return {
    send: useMutation({
      mutationFn: (input: {
        body: string
        visibility: 'customer' | 'internal'
        replyToMessageId?: string
      }) =>
        messageApi.send(conversationId, {
          ...input,
          // Minted per submission, so a double-click or a retried request
          // returns the original message instead of posting a second one.
          clientMessageId: newClientMessageId(),
        }),
      onSuccess: invalidate,
    }),

    edit: useMutation({
      mutationFn: ({ messageId, body }: { messageId: string; body: string }) =>
        messageApi.edit(conversationId, messageId, body),
      onSuccess: invalidate,
    }),

    deleteForMe: useMutation({
      mutationFn: (messageId: string) => messageApi.deleteForMe(conversationId, messageId),
      onSuccess: invalidate,
    }),

    deleteForEveryone: useMutation({
      mutationFn: ({ messageId, reason }: { messageId: string; reason: string }) =>
        messageApi.deleteForEveryone(conversationId, messageId, reason),
      onSuccess: invalidate,
    }),

    forward: useMutation({
      mutationFn: ({
        messageId,
        toConversationIds,
      }: {
        messageId: string
        toConversationIds: string[]
      }) => messageApi.forward(conversationId, messageId, toConversationIds),
      // A forward lands in OTHER conversations, so the queue is stale too.
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: qk.conversations })
      },
    }),

    react: useMutation({
      mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string | null }) =>
        emoji === null
          ? messageApi.unreact(conversationId, messageId)
          : messageApi.react(conversationId, messageId, emoji),
      onSuccess: invalidate,
    }),
  }
}

/**
 * Join the conversation's realtime room while it is open, and leave on close.
 *
 * Re-subscription after a reconnect is the provider's job — rooms do not
 * survive a disconnect server-side — so this only expresses intent.
 */
export function useConversationSubscription(conversationId: string | null): void {
  const { subscribe, unsubscribe, state } = useRealtime()

  useEffect(() => {
    if (!conversationId) return
    void subscribe(conversationId)
    return () => unsubscribe(conversationId)
    // `state` is a dependency so that a reconnect re-runs the ack-bearing
    // subscribe; the provider's own re-emit covers the room, this covers the
    // "who is already typing" answer that only the ack carries.
  }, [conversationId, state, subscribe, unsubscribe])
}

/**
 * Advance the read cursor, and acknowledge delivery.
 *
 * DELIVERED is asserted by the RECIPIENT's client when it actually holds the
 * message — never inferred by the sender. READ follows from the operator
 * having the conversation open, which is what opening it means.
 *
 * Both are monotonic on the server, so a replayed acknowledgement after a
 * reconnect cannot drag a READ back to DELIVERED.
 */
export function useReadReceipts(
  conversationId: string | null,
  messages: Message[],
  viewerActorId: string | null,
): void {
  const { acknowledgeDelivered, state } = useRealtime()
  const acknowledged = useRef(new Set<string>())
  const reportedSeq = useRef(0)

  useEffect(() => {
    acknowledged.current = new Set()
    reportedSeq.current = 0
  }, [conversationId])

  useEffect(() => {
    if (!conversationId || messages.length === 0 || !viewerActorId) return

    // Only messages from somebody else, and only once each: re-rendering the
    // same page must not re-acknowledge every message on it.
    const pending = messages
      .filter((m) => m.authorId !== viewerActorId && !acknowledged.current.has(m.id))
      .map((m) => m.id)

    if (pending.length > 0) {
      for (const id of pending) acknowledged.current.add(id)
      if (state === 'connected') {
        acknowledgeDelivered(pending)
      } else {
        // No socket: fall back to HTTP, one call per message. Failure is not
        // surfaced — a missed acknowledgement is re-sent on the next load, and
        // an error for something the operator did not do would be noise.
        for (const id of pending) {
          void messageApi.markDelivered(conversationId, id).catch(() => {
            acknowledged.current.delete(id)
          })
        }
      }
    }

    const highest = messages.reduce((max, m) => Math.max(max, Number(m.seq ?? 0)), 0)
    if (highest > reportedSeq.current) {
      reportedSeq.current = highest
      void messageApi.markRead(conversationId, String(highest)).catch(() => {
        // Retried on the next render that advances the watermark. Rolling it
        // back here would make every subsequent render re-post the same cursor.
        reportedSeq.current = 0
      })
    }
  }, [conversationId, messages, viewerActorId, state, acknowledgeDelivered])
}
