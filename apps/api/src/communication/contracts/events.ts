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
  CALL_INCOMING: 'call.incoming',
  CALL_ACCEPTED: 'call.accepted',
  CALL_DECLINED: 'call.declined',
  CALL_ENDED: 'call.ended',
  CALL_PARTICIPANT_JOINED: 'call.participant_joined',
  CALL_PARTICIPANT_LEFT: 'call.participant_left',
  NOTIFICATION_CREATED: 'notification.created',
  /**
   * The recipient read something, on one of their devices.
   *
   * Published to the reader's OWN actor room and nowhere else, which is what
   * makes it a cross-device sync rather than a broadcast: every device the
   * parent is signed in on is in that room, and no one else's is.
   */
  NOTIFICATION_READ: 'notification.read',

  /**
   * The class-session projection changed, or an attendance outcome landed.
   *
   * These are CHAT-SIDE domain events about a Core-authoritative fact: Core
   * owns the class, Chat owns the notification. They are enqueued in the same
   * transaction as the projection write, so the fact and the event it justifies
   * commit together or not at all.
   */
  CLASS_SESSION_SCHEDULED: 'class.session_scheduled',
  CLASS_SESSION_RESCHEDULED: 'class.session_rescheduled',
  CLASS_SESSION_CANCELLED: 'class.session_cancelled',
  CLASS_ATTENDANCE_RECORDED: 'class.attendance_recorded',
  /**
   * A staff member changed chat.learner.next_class_at through the existing
   * schedule path. Kept distinct from the class.session_* events above because
   * it describes a different thing: the legacy scalar, not a Core occurrence.
   */
  LEARNER_SCHEDULE_CHANGED: 'learner.schedule_changed',
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

/**
 * A read that happened somewhere else.
 *
 * Exactly one of the three selectors is set, mirroring the three ways a
 * notification can be read: one row, everything (optionally within a category),
 * or everything belonging to a conversation the parent just opened. `readAt`
 * lets a receiving device set the same timestamp rather than inventing its own,
 * so two devices agree on WHEN as well as WHETHER.
 */
export interface NotificationReadPayload {
  recipientId: string;
  notificationId: string | null;
  /** Set together with `all`, when the read was scoped to one category. */
  category: string | null;
  conversationId: string | null;
  /** True when every unread row (within `category`, if given) was marked. */
  all: boolean;
  readAt: string;
}

/**
 * A class-session projection change.
 *
 * Carries the OCCURRENCE identity, not the learner and a time: a consumer must
 * be able to tell one occurrence from another after the time has moved.
 */
export interface ClassSessionPayload {
  classSessionId: string;
  learnerId: string;
  startsAt: string;
  status: string;
  /** Null on a first sighting. Present when a redelivery changed something. */
  previousStartsAt: string | null;
  previousStatus: string | null;
}

export interface ClassAttendancePayload {
  attendanceId: string;
  classSessionId: string;
  learnerId: string;
  /** chat.event_log's vocabulary: `class_attended` or `class_missed`. */
  outcome: string;
  startsAt: string;
  /** Null on a first delivery; used to suppress a no-change redelivery. */
  previousOutcome: string | null;
}

/**
 * The legacy `next_class_at` write path.
 *
 * `previousAt` and `nextAt` are the two times the parent is told about, and
 * they are what makes a stale replay detectable: a handler compares `nextAt`
 * against the learner's CURRENT value before acting.
 */
export interface LearnerScheduleChangedPayload {
  learnerId: string;
  previousAt: string | null;
  nextAt: string | null;
  actorId: string;
  reason: string;
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
  [CommEvent.NOTIFICATION_READ]: NotificationReadPayload;
  [CommEvent.CLASS_SESSION_SCHEDULED]: ClassSessionPayload;
  [CommEvent.CLASS_SESSION_RESCHEDULED]: ClassSessionPayload;
  [CommEvent.CLASS_SESSION_CANCELLED]: ClassSessionPayload;
  [CommEvent.CLASS_ATTENDANCE_RECORDED]: ClassAttendancePayload;
  [CommEvent.LEARNER_SCHEDULE_CHANGED]: LearnerScheduleChangedPayload;
}

/** Rooms a socket may join. Never a client-supplied raw string. */
export const room = {
  conversation: (id: string) => `conversation:${id}`,
  actor: (id: string) => `actor:${id}`,
};
