import {
  Conversation,
  Learner,
  Message,
  MessageAttachment,
  MessageReaction,
  MessageReceipt,
} from '@prisma/client';
import type { ActorRef, ResolvedActors } from '../../platform/identity.service';
import { actorRefKey } from '../../platform/identity.service';
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

  /**
   * The author's canonical display name (mobile gap O3, author half).
   *
   * Resolved server-side from `Actor.displayName` — the same single source as
   * `ConversationMemberDto.displayName` and `ActorDto.displayName`, derived from
   * staff.name / contact.name / teacher.name by `IdentityService`. It is never
   * derived from the role, the actor kind, conversation membership, or a label.
   *
   * NULL, not '', when there is nobody to name: a system message (`authorId` is
   * null by construction) or an author whose actor no longer resolves. It is
   * spelled `string | null` rather than `''` — unlike the member field — because
   * `authorId` on this same DTO is already nullable, so "no author" is a state
   * this DTO already had to express. A null here is the absence of a fact, never
   * a fabricated name; the client's role label is a presentation fallback and is
   * not an identity mechanism.
   */
  authorDisplayName: string | null;

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

  /**
   * The member's display name (mobile gap O3).
   *
   * `displayName` and not `name`: this is an ACTOR, and `Actor.displayName` is
   * already the one name a principal has in this codebase -- IdentityService
   * derives it from staff.name / contact.name / teacher.name and ActorDto
   * publishes it under that spelling. `ConversationLearnerDto.name` is spelled
   * differently on purpose, because a learner is not an actor and that field
   * mirrors a column.
   *
   * EMPTY MEANS UNRESOLVED, NEVER "has no name". A membership row outlives the
   * actor it names (BR-5: departures are recorded, not deleted), so a member
   * whose identity no longer resolves yields '' -- and the client renders that
   * as unresolved rather than falling back to an id, which is what it already
   * does today for every member.
   *
   * PRIVACY: a display name is not a contact channel. Actor carries no phone,
   * email or address field and the chat schema has no such column
   * (no-contact-channel-columns.spec.ts), so this cannot become one. It is
   * returned only for a conversation the caller is already authorized to read.
   */
  displayName: string;

  /**
   * May the CALLER open a 1:1 channel with this member? Advisory only.
   *
   * PD-6 made the teacher/parent pairing undecidable from roles alone: whether a
   * teacher may message a parent depends on a relationship only the server can
   * resolve. Without this the mobile client had two bad options -- offer the
   * action to every parent and let most attempts fail, or offer it to none, which
   * is what it did, leaving the authorized PD-6 channel unreachable from either
   * side.
   *
   * IT IS NOT PERMISSION, exactly as `canCall` is not permission. The request is
   * authorized again on `POST /conversations/direct` by the same
   * `AuthorizationService.canOpenDirect` that computed this, so a stale or forged
   * `true` buys nothing. `false` is the safe default and is what an unresolved
   * viewer, an unknown pair or an absent field all produce.
   *
   * DISCLOSURE: it says only what the caller may do with a member they can
   * already see in a conversation they are already authorized to read. It adds no
   * contact channel and names nobody new -- this is not a directory (§25).
   */
  canOpenDirect: boolean;
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

/**
 * A membership row with its actor's display name already resolved.
 *
 * The name is resolved by the caller (ConversationService.membersOf) rather than
 * here, because resolving an identity is a query and a mapper must not make
 * one. Structural rather than `ConversationMember & {...}`: the mapper needs
 * four columns and a name, and saying so keeps a widened Prisma include from
 * reaching a client through this parameter.
 */
export interface ResolvedMember {
  actorId: string;
  actorKind: string;
  memberRole: string;
  isSilent: boolean;
  /** '' when the actor no longer resolves. Never an id. */
  displayName: string;
  /** Advisory; see ConversationMemberDto.canOpenDirect. False when unknown. */
  canOpenDirect: boolean;
}

export function toConversationDto(
  c: ConversationWithLearner,
  members?: ResolvedMember[],
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
      displayName: m.displayName,
      canOpenDirect: m.canOpenDirect,
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

/**
 * The actor reference a message's author is, or null when it is nobody.
 *
 * `message.author_type` IS the actor kind, so no caller has to discover it — which
 * is what lets a whole page be resolved by kind rather than one row at a time. A
 * system message carries `author_id = null` by construction, and null is the one
 * honest answer for it: there is no person to name.
 *
 * Exported so that the code collecting references for a batch and the code reading
 * the batch back agree by construction rather than by convention.
 */
export function messageAuthorRef(
  m: Pick<Message, 'authorId' | 'authorType'>,
): ActorRef | null {
  return m.authorId ? { actorId: m.authorId, actorKind: m.authorType } : null;
}

type MessageWithRelations = Message & {
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
  receipts?: MessageReceipt[];
};

/**
 * @param authors Resolved authors from `IdentityService.resolveActors`, keyed by
 *   `actorRefKey`. Defaults to empty, which yields `authorDisplayName: null` —
 *   the same answer as an unresolvable author, because a caller that resolved
 *   nobody knows nothing about this author either. The mapper takes a map and
 *   never a service: resolving an identity is a query, and a mapper must not
 *   make one.
 */
export function toMessageDto(
  m: MessageWithRelations,
  signedUrls: Map<string, { url: string; thumbnailUrl: string | null }> = new Map(),
  authors: ResolvedActors = new Map(),
): MessageDto {
  const hidden = m.deletedForAll;
  const author = messageAuthorRef(m);
  return {
    id: m.id,
    conversationId: m.conversationId,
    seq: m.seq?.toString() ?? null,
    authorKind: m.authorType,
    authorId: m.authorId,
    authorDisplayName: author ? (authors.get(actorRefKey(author))?.displayName ?? null) : null,
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
