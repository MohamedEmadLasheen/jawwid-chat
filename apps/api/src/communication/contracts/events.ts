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
  /** A call was created and is ringing. */
  CALL_INCOMING: 'call.incoming',
  /** A participant ANSWERED, at the application level (POST /calls/:id/accept). */
  CALL_ACCEPTED: 'call.accepted',
  /** A participant refused a ringing call. */
  CALL_DECLINED: 'call.declined',
  /** The call reached a terminal state and carries its outcome. */
  CALL_ENDED: 'call.ended',
  /**
   * MEDIA PRESENCE, not application acceptance: this participant is actually
   * connected to the LiveKit room.
   *
   * NOT EMITTED TODAY, deliberately. Only the media server knows it, and the
   * only honest source is a LiveKit webhook, which does not exist yet. Emitting
   * it from `POST /calls/:id/accept` would assert a media connection nobody has
   * observed — a client would render "connected" for a participant whose device
   * had not joined, or never could. `call.accepted` is the event that HTTP
   * accept legitimately produces, and it is what the API emits.
   */
  CALL_PARTICIPANT_JOINED: 'call.participant_joined',
  /** The media-presence counterpart of the above. Also not emitted yet. */
  CALL_PARTICIPANT_LEFT: 'call.participant_left',
  NOTIFICATION_CREATED: 'notification.created',
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

/**
 * `call.incoming`.
 *
 * `roomName` is deliberately NOT here. The room handle comes back from
 * `POST /calls/:id/token` together with the token that makes it usable, which
 * is the authorized path; broadcasting it to a room as well adds nothing a
 * participant can act on and puts a media handle in a fan-out payload. The
 * fewer places it appears, the less a future routing mistake can leak.
 */
export interface CallPayload {
  callId: string;
  conversationId: string;
  type: string;
  initiatorId: string;
  /** Never a phone number. */
  initiatorName: string;
}

export interface CallEndedPayload {
  callId: string;
  conversationId: string;
  outcome: string;
  durationSeconds: number | null;
}

/**
 * `call.accepted`, `call.declined`, `call.participant_joined`,
 * `call.participant_left`.
 *
 * `conversationId` is the ROUTING field and is not optional. The outbox worker
 * routes a call event to `conversation:<id>`; an event that arrives without one
 * cannot be routed and used to be discarded in silence — which is precisely why
 * a caller never learned that the callee had answered or refused.
 *
 * Every field is server-derived: `conversationId` from `chat.call`, `actorId`
 * from the authenticated actor. Nothing here is taken from the request.
 */
export interface CallParticipantPayload {
  callId: string;
  conversationId: string;
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

export interface CommEventPayloads {
  [CommEvent.MESSAGE_CREATED]: MessageCreatedPayload;
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
}

/** Rooms a socket may join. Never a client-supplied raw string. */
export const room = {
  conversation: (id: string) => `conversation:${id}`,
  actor: (id: string) => `actor:${id}`,
};
