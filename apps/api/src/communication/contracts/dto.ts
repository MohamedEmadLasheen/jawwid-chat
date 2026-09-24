import {
  Conversation,
  ConversationMember,
  Learner,
  Message,
  MessageAttachment,
  MessageReaction,
  MessageReceipt,
} from '@prisma/client';
import { ConversationState, Moderation } from './vocab';

/**
 * Safe DTOs. A Prisma entity is never returned from a controller or a gateway.
 *
 * PRIVACY INVARIANT: every mapper enumerates its fields explicitly. There is no
 * spread of a database row into a response anywhere in the communication
 * engine, so a column added upstream cannot leak into an API payload by
 * accident. The chat schema has no phone column to begin with.
 */

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

export interface MessageDto {
  id: string;
  conversationId: string | null;
  /** Stringified: seq is 64-bit and JSON numbers are not safe at that width. */
  seq: string | null;
  authorKind: string;
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
  reactions: Array<{ actorId: string; emoji: string }>;
  receipts: Array<{ actorId: string; state: string; deliveredAt: string | null; readAt: string | null }>;
}

export interface ConversationMemberDto {
  actorId: string;
  actorKind: string;
  memberRole: string;
  isSilent: boolean;
}

/**
 * The learner a conversation is about, as a client may see them.
 *
 * Two fields, and no third. `learnerId` has always been on ConversationDto, but
 * an id is not renderable: a parent with two children needs a NAME on the
 * section heading, and the alternative -- letting the client parse it out of
 * the conversation title -- is inference dressed up as data.
 *
 * What is deliberately NOT here: `level`, `nextClassAt`, `teacherId`,
 * `familyId`. They exist on chat.learner and are operational detail a parent's
 * chat list has no use for (PRIVACY INVARIANT above, and boundary doc 25). A
 * field added to the Learner model cannot appear here by accident.
 */
export interface ConversationLearnerDto {
  id: string;
  name: string;
}

export interface ConversationDto {
  id: string;
  type: string;
  familyId: string | null;
  learnerId: string | null;
  title: string | null;
  state: string;
  needsReply: boolean;
  lastSeq: string;
  lastActivityAt: string;
  archivedAt: string | null;
  teacherRequiresApproval: boolean;
  parentRequiresApproval: boolean;
  members?: ConversationMemberDto[];

  /**
   * Resolved learner, when the caller loaded one. Optional like `members`:
   * absent means "not loaded here", never "this conversation has no learner" --
   * `learnerId` remains the authority on that, and stays for existing
   * consumers.
   */
  learner?: ConversationLearnerDto | null;

  /**
   * Messages in this conversation the requesting actor has not read.
   *
   * Server-derived and per-actor. Optional because the create/sync endpoints
   * do not compute it; absent means "not computed here", never zero.
   */
  unreadCount?: number;
}

export function needsReply(
  c: Pick<Conversation, 'lastCustomerMessageAt' | 'lastStaffMessageAt'>,
): boolean {
  if (!c.lastCustomerMessageAt) return false;
  if (!c.lastStaffMessageAt) return true;
  return c.lastCustomerMessageAt > c.lastStaffMessageAt;
}

/**
 * Conversation state is computed, never a client-settable field.
 * chat.support_case.status remains the ops domain and is not duplicated here.
 */
export function conversationState(
  c: Pick<Conversation, 'lastCustomerMessageAt' | 'lastStaffMessageAt' | 'resolvedAt'>,
): string {
  if (c.resolvedAt) return ConversationState.RESOLVED;
  if (needsReply(c)) return ConversationState.WAITING_ON_JAWWID;
  if (c.lastStaffMessageAt) return ConversationState.WAITING_ON_CUSTOMER;
  return ConversationState.OPEN;
}

/** A conversation row loaded with `include: { learner: true }`. */
export type ConversationWithLearner = Conversation & { learner?: Learner | null };

export function toConversationDto(
  c: ConversationWithLearner,
  members?: ConversationMember[],
  extra?: { unreadCount?: number },
): ConversationDto {
  return {
    id: c.id,
    type: c.type,
    familyId: c.familyId,
    learnerId: c.learnerId,
    title: c.title,
    state: conversationState(c),
    needsReply: needsReply(c),
    lastSeq: c.lastSeq.toString(),
    lastActivityAt: c.lastActivityAt.toISOString(),
    archivedAt: c.archivedAt?.toISOString() ?? null,
    teacherRequiresApproval: c.teacherRequiresApproval,
    parentRequiresApproval: c.parentRequiresApproval,
    members: members?.map((m) => ({
      actorId: m.actorId,
      actorKind: m.actorKind,
      memberRole: m.memberRole,
      isSilent: m.isSilent,
    })),
    // Two fields enumerated by hand, like every other field here: the Learner
    // row is never spread, so `level`, `nextClassAt` and `teacherId` cannot
    // reach a client because somebody widened an include.
    learner: c.learner ? { id: c.learner.id, name: c.learner.name } : undefined,
    unreadCount: extra?.unreadCount,
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

type MessageWithRelations = Message & {
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
  receipts?: MessageReceipt[];
};

export function toMessageDto(
  m: MessageWithRelations,
  signedUrls: Map<string, { url: string; thumbnailUrl: string | null }> = new Map(),
): MessageDto {
  const hidden = m.deletedForAll;
  return {
    id: m.id,
    conversationId: m.conversationId,
    seq: m.seq?.toString() ?? null,
    authorKind: m.authorType,
    authorId: m.authorId,
    onBehalfMode: m.onBehalfMode,
    type: m.type,
    // A message deleted for everyone keeps its row for auditability, but its
    // body is never served again.
    body: hidden ? null : m.body,
    visibility: m.visibility,
    moderation: m.moderation,
    origin: m.origin,
    replyToMessageId: m.replyToMessageId,
    clientMessageId: m.clientMessageId,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    deletedForAll: m.deletedForAll,
    createdAt: m.createdAt.toISOString(),
    attachments: hidden
      ? []
      : (m.attachments ?? []).map((a) => {
          const signed = signedUrls.get(a.id);
          return toAttachmentDto(a, signed?.url ?? null, signed?.thumbnailUrl ?? null);
        }),
    reactions: (m.reactions ?? []).map((r) => ({ actorId: r.actorId, emoji: r.emoji })),
    receipts: (m.receipts ?? []).map((r) => ({
      actorId: r.actorId,
      state: r.state,
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      readAt: r.readAt?.toISOString() ?? null,
    })),
  };
}

/** What a pending message looks like to someone who may not read it yet. */
export function redactPending(dto: MessageDto): MessageDto {
  if (dto.moderation !== Moderation.PENDING) return dto;
  return { ...dto, body: null, attachments: [] };
}
