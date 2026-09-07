import type {
  ActorKind,
  ConversationState,
  Moderation,
  ReceiptState,
  Visibility,
} from '@/shared/types/conversation'

/**
 * THE CANONICAL REALTIME EVENTS.
 *
 * Names and payloads mirror `apps/api/src/communication/contracts/events.ts`.
 * The brief-era set this replaced (`family.updated`, `case.updated`,
 * `task.updated`, `handoff.created`, `coverage.changed`, `shift.ending`, …)
 * shared exactly two names with the API and neither payload matched.
 *
 * ## Events are SIGNALS, NOT STATE
 *
 * On receipt the console invalidates the affected query and refetches. It does
 * not patch a payload into the cache. Two reasons, and both are load-bearing:
 *
 *  - the server decides what THIS operator may see. A `message.created` payload
 *    deliberately carries no body, because the body is subject to per-reader
 *    rules — internal-note visibility, hidden-for-me, approval state — that
 *    only the read path applies. Patching it in would render text the reader
 *    may not be entitled to.
 *  - refetching reconciles concurrent edits to the server rather than to
 *    whichever tab wrote last.
 *
 * `message.updated` is the one event that carries content, and it is safe
 * because the API emits it only to the audience that could already read the
 * message. The console still refetches, for consistency of a single rule.
 */
export interface ServerEvents {
  'message.created': {
    conversationId: string
    messageId: string
    seq: string
    authorKind: ActorKind
    authorId: string | null
    type: string
    visibility: Visibility
    moderation: Moderation
    createdAt: string
  }
  'message.updated': {
    conversationId: string
    messageId: string
    seq: string | null
    body: string | null
    editedAt: string
    editCount: number
  }
  'message.deleted': {
    conversationId: string
    messageId: string
    deletedForAll: boolean
  }
  'message.receipt.updated': {
    conversationId: string
    messageId: string
    actorId: string
    state: ReceiptState
    at: string
  }
  'reaction.added': {
    conversationId: string
    messageId: string
    actorId: string
    emoji: string
  }
  'reaction.removed': {
    conversationId: string
    messageId: string
    actorId: string
    emoji: string
  }
  'typing.started': { conversationId: string; actorId: string; displayName: string }
  'typing.stopped': { conversationId: string; actorId: string; displayName: string }
  'presence.changed': {
    actorId: string
    state: 'online' | 'offline'
    lastSeenAt: string | null
  }
  'conversation.updated': {
    conversationId: string
    familyId: string | null
    state: ConversationState
    needsReply: boolean
    lastActivityAt: string
    handlerId: string | null
  }
  'conversation.membership_changed': {
    conversationId: string
    added: string[]
    removed: string[]
  }
  'approval.requested': {
    conversationId: string
    messageId: string
    approvalId: string
    requestedBy: string
    /**
     * Phase 6, all optional so the payload stays backward-compatible with the
     * Phase 2 clients already consuming this event. CATEGORIES, never excerpts:
     * a badge needs "a phone number", and the matched text is held content read
     * through the permission-checked queue.
     */
    trigger?: 'policy' | 'scan'
    categories?: string[]
    highestSeverity?: string | null
  }
  'approval.decided': {
    conversationId: string
    messageId: string
    approvalId: string
    decision: string
    rejectionReason: string | null
    /** Phase 6: the decision was EDIT THEN SEND rather than a plain approval. */
    edited?: boolean
  }
  /**
   * Phase 6. A held message passed `moderation.escalation_hours` without a
   * decision and is now a manager's.
   *
   * Carries no body and no excerpt: the manager opens the queue to read the
   * message, and an event that carried the text would put held content into a
   * transport whose audience is a room rather than a permission check.
   */
  'moderation.escalated': {
    conversationId: string
    messageId: string
    approvalId: string
    escalatedTo: string
    highestSeverity: string | null
    pendingSinceMs: number
  }
  'notification.created': {
    notificationId: string
    recipientId: string
    eventType: string
    title: string
    body: string
    conversationId: string | null
  }
}

export type ServerEventName = keyof ServerEvents

export type ConnectionState = 'connecting' | 'connected' | 'disconnected'

/** Client → server frames. A client never names a room; it names a conversation. */
export const ClientFrame = {
  subscribe: 'conversation.subscribe',
  unsubscribe: 'conversation.unsubscribe',
  typingStart: 'typing.start',
  typingStop: 'typing.stop',
  delivered: 'message.delivered',
  heartbeat: 'presence.heartbeat',
} as const
