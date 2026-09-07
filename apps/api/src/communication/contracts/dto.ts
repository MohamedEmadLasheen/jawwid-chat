import {
  Conversation,
  ConversationMember,
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

/**
 * The quoted message shown above a reply.
 *
 * DEGRADES RATHER THAN LEAKS. The excerpt is present only when the viewer may
 * actually read the target; in every other case -- deleted for everyone, held
 * for approval, an internal note seen by a contact, hidden by this viewer, or
 * simply gone -- `available` is false and `excerpt` is null. The reply itself
 * still renders, saying "this message is unavailable", which is what a quote of
 * a withdrawn message must look like. See `unavailableReason` for which of the
 * cases it was: the client renders "deleted" differently from "not available".
 */
export interface ReplyPreviewDto {
  messageId: string;
  available: boolean;
  unavailableReason: 'deleted' | 'restricted' | 'missing' | null;
  authorKind: string | null;
  authorId: string | null;
  type: string | null;
  /** First line of the quoted body, truncated. Null when not available. */
  excerpt: string | null;
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
  /** Populated by the read path when it resolved the target; null otherwise. */
  replyPreview: ReplyPreviewDto | null;
  clientMessageId: string | null;
  editedAt: string | null;
  editCount: number;
  /**
   * True when this message was forwarded from somewhere else. Deliberately a
   * BOOLEAN: the source conversation is often one the reader may not access,
   * and naming it would be a disclosure the forwarding UI never intended. The
   * ids stay in the database for audit.
   */
  isForwarded: boolean;
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
  /** Resolved when the caller asked for it. Never a phone number or e-mail. */
  displayName?: string;
}

/**
 * What a chat-list row needs beyond the conversation itself.
 *
 * Supplied by the LIST endpoint, computed in two batched queries for the whole
 * page. It used to be absent, and the mobile client's own notes record the
 * consequence: one round trip PER ROW for the unread count alone, on exactly
 * the slow networks this product targets.
 */
export interface ConversationRowExtras {
  unreadCount: number;
  /** Empty for a conversation whose newest message this viewer may not read. */
  lastMessagePreview: string;
  lastMessageAt: string | null;
  lastMessageAuthorId: string | null;
  /** Per-viewer preferences, never another participant's. */
  isPinned: boolean;
  isMuted: boolean;
  isArchivedForMe: boolean;
}

export interface ConversationDto extends Partial<ConversationRowExtras> {
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

export function toConversationDto(
  c: Conversation,
  members?: Array<ConversationMember & { displayName?: string }>,
  extras?: ConversationRowExtras,
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
      ...(m.displayName === undefined ? {} : { displayName: m.displayName }),
    })),
    ...(extras ?? {}),
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

/**
 * Who is being served this message.
 *
 * RT-012 / A-7: the receipt roster is a list of WHICH staff member read the
 * message and WHEN. Serving it to a family contact hands them Jawwid's internal
 * actor ids and the reading habits of the people handling them -- neither of
 * which they asked for or need. A parent needs one fact: has my message been
 * read at all.
 *
 * The default is the restrictive one. A caller that does not say who is looking
 * gets no roster, because the safe direction for a forgotten argument is less
 * disclosure rather than more.
 */
export interface MessageViewer {
  actorId: string;
  /** True only for family-facing staff, who need the roster to do the job. */
  seesFullRoster: boolean;
}

/** First line of a body, bounded, for a quote. */
export const QUOTE_EXCERPT_LENGTH = 140;

export function excerptOf(body: string | null): string | null {
  if (body === null) return null;
  const firstLine = body.split('\n', 1)[0].trim();
  return firstLine.length > QUOTE_EXCERPT_LENGTH
    ? `${firstLine.slice(0, QUOTE_EXCERPT_LENGTH)}…`
    : firstLine;
}

/** A quote of a message that cannot be shown, without saying why in detail. */
export function unavailableReply(
  messageId: string,
  reason: 'deleted' | 'restricted' | 'missing',
): ReplyPreviewDto {
  return {
    messageId,
    available: false,
    unavailableReason: reason,
    authorKind: null,
    authorId: null,
    type: null,
    excerpt: null,
  };
}

export function toMessageDto(
  m: MessageWithRelations,
  signedUrls: Map<string, { url: string; thumbnailUrl: string | null }> = new Map(),
  viewer?: MessageViewer,
  replyPreview: ReplyPreviewDto | null = null,
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
    // A deleted message shows no quote either: the point of withdrawing it is
    // that its content stops being served, and a quote is content.
    replyPreview: hidden ? null : replyPreview,
    clientMessageId: m.clientMessageId,
    editedAt: hidden ? null : (m.editedAt?.toISOString() ?? null),
    editCount: hidden ? 0 : m.editCount,
    isForwarded: !hidden && m.forwardedFromMessageId !== null,
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
    receipts: (m.receipts ?? [])
      .filter((r) => viewer?.seesFullRoster === true || r.actorId === viewer?.actorId)
      .map((r) => ({
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
  // replyPreview goes too: quoting is a way of restating, and a redaction that
  // leaves the quote intact has redacted nothing that matters.
  return { ...dto, body: null, attachments: [], replyPreview: null };
}
