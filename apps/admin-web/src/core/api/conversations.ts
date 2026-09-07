import { api } from './client'
import type {
  Conversation,
  Message,
  MessagePage,
  MessageRevision,
  MessageSearchResult,
} from '@/shared/types/conversation'

/**
 * THE CANONICAL MESSAGING ENDPOINTS.
 *
 * One typed function per route, and every path here is a route the API
 * actually serves — verified against
 * `apps/api/src/communication/api/{conversation,message}.controller.ts`. The
 * CRM surface in `endpoints.ts` (`/inbox`, `/families/:id/messages`, `/tasks`,
 * `/coverage`, `/dashboard`) is frozen alongside the features that call it;
 * nothing in the console imports from there.
 *
 * ## Two rules this file exists to keep
 *
 * **The console never invents a route.** Every gap in the operations console —
 * the family directory, the staff picker, supervisor assignment — is a route
 * the API does not serve, and it is left unbuilt rather than approximated
 * client-side.
 *
 * **The server authorizes; this only asks.** Every path below is scoped by the
 * API to what this operator may see. There is no client-side filter that
 * decides which conversations exist.
 */
export const conversationApi = {
  /** The chat list, RBAC-scoped, each row carrying unread + last message. */
  list: () => api.get<{ conversations: Conversation[] }>('/conversations'),

  /** One conversation, carrying the same row data the list does. */
  get: (id: string) => api.get<Conversation>(`/conversations/${id}`),

  /** By title or by a participant's name. Scoped by the server, never a directory. */
  search: (q: string) =>
    api.get<{ conversations: Conversation[] }>('/conversations/search', { q }),

  /** Per-operator preferences. One operator's pin never affects another's. */
  setPreferences: (
    id: string,
    prefs: { archived?: boolean; pinned?: boolean; mutedUntil?: string | null },
  ) => api.post<{ ok: true }>(`/conversations/${id}/preferences`, prefs),
}

export const messageApi = {
  /**
   * Paginate by `seq`, never by timestamp.
   *
   * `before` walks back through history; `after` catches up from a watermark
   * after a reconnect. Both are deterministic regardless of device clocks.
   */
  page: (conversationId: string, before?: string, limit = 40) =>
    api.get<MessagePage>(`/conversations/${conversationId}/messages`, { before, limit }),

  since: (conversationId: string, afterSeq: string) =>
    api.get<MessagePage>(`/conversations/${conversationId}/messages`, { after: afterSeq }),

  /**
   * Send.
   *
   * `clientMessageId` is the idempotency key and lives in the BODY, not in an
   * `Idempotency-Key` header — that is what the API reads. `onBehalfMode` is
   * deliberately absent: the server derives attribution from on-duty state, and
   * a client that could choose it could stamp its own message as the family's
   * owner.
   */
  send: (
    conversationId: string,
    input: {
      body: string
      visibility: 'customer' | 'internal'
      clientMessageId: string
      replyToMessageId?: string
    },
  ) => api.post<Message>(`/conversations/${conversationId}/messages`, input),

  /** Author only, inside the server's edit window. */
  edit: (conversationId: string, messageId: string, body: string) =>
    api.patch<Message>(`/conversations/${conversationId}/messages/${messageId}`, { body }),

  /** Moderation material: requires `messages.moderate`, not mere membership. */
  revisions: (conversationId: string, messageId: string) =>
    api.get<{ revisions: MessageRevision[] }>(
      `/conversations/${conversationId}/messages/${messageId}/revisions`,
    ),

  /** Hide from THIS operator's view. Everyone else keeps their copy. */
  deleteForMe: (conversationId: string, messageId: string) =>
    api.delete<{ ok: true }>(`/conversations/${conversationId}/messages/${messageId}/me`),

  /** Withdraw for everyone. The API requires a reason and audits it. */
  deleteForEveryone: (conversationId: string, messageId: string, reason: string) =>
    api.delete<{ ok: true }>(
      `/conversations/${conversationId}/messages/${messageId}?reason=${encodeURIComponent(reason)}`,
    ),

  /** Two authorizations: the source is read-checked, each destination send-checked. */
  forward: (conversationId: string, messageId: string, toConversationIds: string[]) =>
    api.post<{ messages: Message[] }>(
      `/conversations/${conversationId}/messages/${messageId}/forward`,
      { toConversationIds },
    ),

  react: (conversationId: string, messageId: string, emoji: string) =>
    api.post<{ ok: true }>(
      `/conversations/${conversationId}/messages/${messageId}/reactions`,
      { emoji },
    ),

  unreact: (conversationId: string, messageId: string) =>
    api.delete<{ ok: true }>(
      `/conversations/${conversationId}/messages/${messageId}/reactions`,
    ),

  /** The read cursor. Monotonic on the server; a replayed older value is ignored. */
  markRead: (conversationId: string, upToSeq: string) =>
    api.post<{ ok: true }>(`/conversations/${conversationId}/messages/read`, { upToSeq }),

  /**
   * Confirm the operator's browser holds these messages.
   *
   * The HTTP fallback for when the socket is down; when it is up the
   * acknowledgement rides on it instead, one frame for a whole page.
   */
  markDelivered: (conversationId: string, messageId: string) =>
    api.post<{ updated: number }>(
      `/conversations/${conversationId}/messages/${messageId}/delivered`,
    ),

  unread: (conversationId: string) =>
    api.get<{ unread: number }>(`/conversations/${conversationId}/messages/unread`),

  /** Across every conversation this operator may read, or scoped to one. */
  search: (input: {
    q: string
    conversationId?: string
    authorId?: string
    from?: string
    to?: string
    limit?: number
  }) => {
    const { conversationId, ...query } = input
    return conversationId
      ? api.get<MessageSearchResult>(
          `/conversations/${conversationId}/messages/search`,
          query,
        )
      : api.get<MessageSearchResult>('/search/messages', query)
  },
}
