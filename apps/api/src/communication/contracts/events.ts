/**
 * Realtime event contracts.
 *
 * Every event has a named constant and a typed payload. No code in this repo
 * emits a raw string event. AI #3 (mobile) and AI #4 (admin web) generate their
 * client types from this file; see docs/communication/realtime-events.md.
 *
 * PRIVACY: no payload carries a phone number, email or address. Actors appear
 * as opaque ids plus a display name.
 */

export const CommEvent = {
  MESSAGE_CREATED: 'message.created',
  /** The body or the moderation state of an existing message changed. */
  MESSAGE_UPDATED: 'message.updated',
  MESSAGE_DELETED: 'message.deleted',
  MESSAGE_RECEIPT_UPDATED: 'message.receipt.updated',
  REACTION_ADDED: 'reaction.added',
  REACTION_REMOVED: 'reaction.removed',
  TYPING_STARTED: 'typing.started',
  TYPING_STOPPED: 'typing.stopped',
  PRESENCE_CHANGED: 'presence.changed',
  CONVERSATION_UPDATED: 'conversation.updated',
  MEMBERSHIP_CHANGED: 'conversation.membership_changed',
  APPROVAL_REQUESTED: 'approval.requested',
  APPROVAL_DECIDED: 'approval.decided',
  CALL_INCOMING: 'call.incoming',
  CALL_ACCEPTED: 'call.accepted',
  CALL_DECLINED: 'call.declined',
  CALL_ENDED: 'call.ended',
  CALL_PARTICIPANT_JOINED: 'call.participant_joined',
  CALL_PARTICIPANT_LEFT: 'call.participant_left',
  NOTIFICATION_CREATED: 'notification.created',
  /**
   * The socket has lost access to a conversation it was subscribed to.
   *
   * Emitted to ONE socket, not to the room: by the time it is sent the socket
   * has already been removed from that room, so a room broadcast would not
   * reach it. The removal is the security act; this event is how the client
   * learns to close the screen instead of showing a thread that has quietly
   * stopped updating.
   */
  ACCESS_REVOKED: 'conversation.access_revoked',
} as const;

export type CommEventName = (typeof CommEvent)[keyof typeof CommEvent];

export interface MessageCreatedPayload {
  conversationId: string;
  messageId: string;
  seq: string;
  authorKind: string;
  authorId: string | null;
  type: string;
  visibility: string;
  moderation: string;
  createdAt: string;
}

/**
 * An existing message changed.
 *
 * The new body travels with the event so a client can update its copy without a
 * round trip. It is emitted only for CUSTOMER-visible messages on the
 * conversation room, and only for published ones -- an edit to a message the
 * recipient could not read in the first place is not broadcast at all.
 */
export interface MessageUpdatedPayload {
  conversationId: string;
  messageId: string;
  seq: string | null;
  body: string | null;
  editedAt: string;
  editCount: number;
}

export interface MessageDeletedPayload {
  conversationId: string;
  messageId: string;
  deletedForAll: boolean;
}

export interface MessageReceiptUpdatedPayload {
  conversationId: string;
  messageId: string;
  actorId: string;
  state: string;
  at: string;
}

export interface ReactionPayload {
  conversationId: string;
  messageId: string;
  actorId: string;
  emoji: string;
}

export interface TypingPayload {
  conversationId: string;
  actorId: string;
  displayName: string;
}

export interface PresencePayload {
  actorId: string;
  state: 'online' | 'offline';
  lastSeenAt: string | null;
}

export interface ConversationUpdatedPayload {
  conversationId: string;
  familyId: string | null;
  state: string;
  needsReply: boolean;
  lastActivityAt: string;
  handlerId: string | null;
}

export interface MembershipChangedPayload {
  conversationId: string;
  added: string[];
  removed: string[];
}

export interface ApprovalRequestedPayload {
  conversationId: string;
  messageId: string;
  approvalId: string;
  requestedBy: string;
}

export interface ApprovalDecidedPayload {
  conversationId: string;
  messageId: string;
  approvalId: string;
  decision: string;
  rejectionReason: string | null;
}

export interface CallPayload {
  callId: string;
  conversationId: string;
  type: string;
  initiatorId: string;
  /** Never a phone number. */
  initiatorName: string;
  roomName: string;
}

export interface CallEndedPayload {
  callId: string;
  conversationId: string;
  outcome: string;
  durationSeconds: number | null;
}

export interface CallParticipantPayload {
  callId: string;
  actorId: string;
}

export interface NotificationCreatedPayload {
  notificationId: string;
  recipientId: string;
  eventType: string;
  title: string;
  body: string;
  conversationId: string | null;
}

export interface AccessRevokedPayload {
  conversationId: string;
  /** A stable code, not prose: the client branches on it. */
  reason: 'out_of_scope' | 'not_a_member' | 'session_ended';
}

export interface CommEventPayloads {
  [CommEvent.MESSAGE_CREATED]: MessageCreatedPayload;
  [CommEvent.MESSAGE_UPDATED]: MessageUpdatedPayload;
  [CommEvent.MESSAGE_DELETED]: MessageDeletedPayload;
  [CommEvent.MESSAGE_RECEIPT_UPDATED]: MessageReceiptUpdatedPayload;
  [CommEvent.REACTION_ADDED]: ReactionPayload;
  [CommEvent.REACTION_REMOVED]: ReactionPayload;
  [CommEvent.TYPING_STARTED]: TypingPayload;
  [CommEvent.TYPING_STOPPED]: TypingPayload;
  [CommEvent.PRESENCE_CHANGED]: PresencePayload;
  [CommEvent.CONVERSATION_UPDATED]: ConversationUpdatedPayload;
  [CommEvent.MEMBERSHIP_CHANGED]: MembershipChangedPayload;
  [CommEvent.APPROVAL_REQUESTED]: ApprovalRequestedPayload;
  [CommEvent.APPROVAL_DECIDED]: ApprovalDecidedPayload;
  [CommEvent.CALL_INCOMING]: CallPayload;
  [CommEvent.CALL_ACCEPTED]: CallParticipantPayload;
  [CommEvent.CALL_DECLINED]: CallParticipantPayload;
  [CommEvent.CALL_ENDED]: CallEndedPayload;
  [CommEvent.CALL_PARTICIPANT_JOINED]: CallParticipantPayload;
  [CommEvent.CALL_PARTICIPANT_LEFT]: CallParticipantPayload;
  [CommEvent.NOTIFICATION_CREATED]: NotificationCreatedPayload;
  [CommEvent.ACCESS_REVOKED]: AccessRevokedPayload;
}


/** Rooms a socket may join. Never a client-supplied raw string. */
export const room = {
  conversation: (id: string) => `conversation:${id}`,
  actor: (id: string) => `actor:${id}`,
};
