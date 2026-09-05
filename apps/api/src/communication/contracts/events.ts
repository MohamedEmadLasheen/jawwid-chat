/**
 * Realtime event contracts.
 *
 * Every event has a named constant and a typed payload. No code in this repo may
 * emit a raw string event. AI #3 (mobile) and AI #4 (admin web) generate their
 * client types from this file; see docs/communication/realtime-events.md.
 *
 * PRIVACY: no payload carries a phone number, email, or address. Participants
 * are identified by userId + displayName + role only.
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
  THREAD_UPDATED: 'thread.updated',
  HANDOFF_CREATED: 'handoff.created',
  NOTIFICATION_CREATED: 'notification.created',
} as const;

export type CommEventName = (typeof CommEvent)[keyof typeof CommEvent];

export interface MessageCreatedPayload {
  threadId: string;
  messageId: string;
  seq: string;
  authorType: 'CONTACT' | 'STAFF' | 'SYSTEM';
  authorId: string | null;
  type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'VOICE' | 'FILE' | 'SYSTEM';
  visibility: 'CUSTOMER' | 'INTERNAL';
  createdAt: string;
}

export interface MessageDeletedPayload {
  threadId: string;
  messageId: string;
  deletedForAll: boolean;
}

export interface MessageReceiptUpdatedPayload {
  threadId: string;
  messageId: string;
  userId: string;
  state: 'SENT' | 'DELIVERED' | 'READ';
  at: string;
}

export interface ReactionPayload {
  threadId: string;
  messageId: string;
  userId: string;
  emoji: string;
}

export interface TypingPayload {
  threadId: string;
  userId: string;
  displayName: string;
}

export interface PresencePayload {
  userId: string;
  state: 'ONLINE' | 'OFFLINE';
  lastSeenAt: string | null;
}

export interface ThreadUpdatedPayload {
  threadId: string;
  familyId: string;
  needsReply: boolean;
  state: 'OPEN' | 'WAITING_ON_CUSTOMER' | 'WAITING_ON_JAWWID' | 'RESOLVED';
  lastActivityAt: string;
  handlerId: string | null;
}

export interface HandoffCreatedPayload {
  threadId: string;
  handoffId: string;
  fromStaffId: string | null;
  toStaffId: string | null;
  reason: string;
}

export interface NotificationCreatedPayload {
  notificationId: string;
  recipientId: string;
  eventType: string;
  title: string;
  body: string;
  threadId: string | null;
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
  [CommEvent.THREAD_UPDATED]: ThreadUpdatedPayload;
  [CommEvent.HANDOFF_CREATED]: HandoffCreatedPayload;
  [CommEvent.NOTIFICATION_CREATED]: NotificationCreatedPayload;
}

/** Rooms a socket may join. Never a client-supplied raw string. */
export const room = {
  thread: (threadId: string) => `thread:${threadId}`,
  user: (userId: string) => `user:${userId}`,
};
