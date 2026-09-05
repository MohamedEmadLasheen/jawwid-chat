import {
  Message,
  MessageAttachment,
  MessageReaction,
  MessageReceipt,
  Thread,
} from '@prisma/client';

/**
 * Safe DTOs. Prisma entities are never returned from a controller or gateway.
 *
 * PRIVACY INVARIANT: these mappers enumerate fields explicitly. There is no
 * spread of a database row into a response anywhere in the communication
 * engine, so a column added upstream (a phone number, an address) cannot leak
 * into an API payload by accident.
 */

export type ConversationState =
  | 'OPEN'
  | 'WAITING_ON_CUSTOMER'
  | 'WAITING_ON_JAWWID'
  | 'RESOLVED';

export interface AttachmentDto {
  id: string;
  kind: string;
  mimeType: string;
  byteSize: number;
  originalName: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** Short-lived signed URL. Never a permanent public storage URL. */
  url: string | null;
  thumbnailUrl: string | null;
}

export interface ReactionDto {
  userId: string;
  emoji: string;
}

export interface ReceiptDto {
  userId: string;
  state: string;
  deliveredAt: string | null;
  readAt: string | null;
}

export interface MessageDto {
  id: string;
  threadId: string;
  caseId: string | null;
  /** Stringified because seq is a 64-bit integer; JSON numbers are not safe. */
  seq: string;
  authorType: string;
  authorId: string | null;
  onBehalfMode: string | null;
  type: string;
  body: string | null;
  visibility: string;
  moderation: string;
  origin: string;
  replyToMessageId: string | null;
  clientMessageId: string | null;
  deletedAt: string | null;
  deletedForAll: boolean;
  createdAt: string;
  attachments: AttachmentDto[];
  reactions: ReactionDto[];
  receipts: ReceiptDto[];
}

export interface ThreadDto {
  id: string;
  kind: string;
  familyId: string;
  state: ConversationState;
  needsReply: boolean;
  lastSeq: string;
  lastActivityAt: string;
  lastCustomerMessageAt: string | null;
  lastStaffMessageAt: string | null;
  stickyHandlerId: string | null;
  stickyUntil: string | null;
  resolvedAt: string | null;
}

type MessageWithRelations = Message & {
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
  receipts?: MessageReceipt[];
};

export function needsReply(thread: Pick<Thread, 'lastCustomerMessageAt' | 'lastStaffMessageAt'>): boolean {
  if (!thread.lastCustomerMessageAt) return false;
  if (!thread.lastStaffMessageAt) return true;
  return thread.lastCustomerMessageAt > thread.lastStaffMessageAt;
}

/**
 * Conversation state, computed - never a stored, client-settable field.
 *
 * The authoritative brief puts open/waiting/resolved on `case`, which is the ops
 * domain (AI #4). This is the thread-level projection the AI #2 brief asks for,
 * derived from thread facts the communication engine owns, plus an explicit
 * staff-set resolvedAt marker. It does not duplicate case status.
 */
export function conversationState(
  thread: Pick<Thread, 'lastCustomerMessageAt' | 'lastStaffMessageAt' | 'resolvedAt'>,
): ConversationState {
  if (thread.resolvedAt) return 'RESOLVED';
  if (needsReply(thread)) return 'WAITING_ON_JAWWID';
  if (thread.lastStaffMessageAt) return 'WAITING_ON_CUSTOMER';
  return 'OPEN';
}

export function toThreadDto(thread: Thread): ThreadDto {
  return {
    id: thread.id,
    kind: thread.kind,
    familyId: thread.familyId,
    state: conversationState(thread),
    needsReply: needsReply(thread),
    lastSeq: thread.lastSeq.toString(),
    lastActivityAt: thread.lastActivityAt.toISOString(),
    lastCustomerMessageAt: thread.lastCustomerMessageAt?.toISOString() ?? null,
    lastStaffMessageAt: thread.lastStaffMessageAt?.toISOString() ?? null,
    stickyHandlerId: thread.stickyHandlerId,
    stickyUntil: thread.stickyUntil?.toISOString() ?? null,
    resolvedAt: thread.resolvedAt?.toISOString() ?? null,
  };
}

export function toAttachmentDto(
  a: MessageAttachment,
  url: string | null = null,
  thumbnailUrl: string | null = null,
): AttachmentDto {
  return {
    id: a.id,
    kind: a.kind,
    mimeType: a.mimeType,
    byteSize: a.byteSize,
    originalName: a.originalName,
    durationMs: a.durationMs,
    width: a.width,
    height: a.height,
    url,
    thumbnailUrl,
  };
}

export function toMessageDto(
  m: MessageWithRelations,
  signedUrls: Map<string, { url: string; thumbnailUrl: string | null }> = new Map(),
): MessageDto {
  return {
    id: m.id,
    threadId: m.threadId,
    caseId: m.caseId,
    seq: m.seq.toString(),
    authorType: m.authorType,
    authorId: m.authorId,
    onBehalfMode: m.onBehalfMode,
    type: m.type,
    // A message deleted for everyone keeps its row for auditability but its body
    // is never served again.
    body: m.deletedForAll ? null : m.body,
    visibility: m.visibility,
    moderation: m.moderation,
    origin: m.origin,
    replyToMessageId: m.replyToMessageId,
    clientMessageId: m.clientMessageId,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    deletedForAll: m.deletedForAll,
    createdAt: m.createdAt.toISOString(),
    attachments: m.deletedForAll
      ? []
      : (m.attachments ?? []).map((a) => {
          const signed = signedUrls.get(a.id);
          return toAttachmentDto(a, signed?.url ?? null, signed?.thumbnailUrl ?? null);
        }),
    reactions: (m.reactions ?? []).map((r) => ({ userId: r.userId, emoji: r.emoji })),
    receipts: (m.receipts ?? []).map((r) => ({
      userId: r.userId,
      state: r.state,
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      readAt: r.readAt?.toISOString() ?? null,
    })),
  };
}
