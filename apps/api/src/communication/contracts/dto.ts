import {
  Conversation,
  Learner,
  Message,
  MessageAttachment,
  MessageCard,
  MessageReaction,
  MessageReceipt,
} from '@prisma/client';
import type { ActorRef, ResolvedActors } from '../../platform/identity.service';
import type { Actor } from '../../platform/types';
import { actorRefKey } from '../../platform/identity.service';
import { ConversationState, Moderation, ReceiptState } from './vocab';

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

  /**
   * The author's profile photo: a signed /media/avatars link for THIS viewer in
   * THIS conversation, or null (no photo, a system message, an unresolved
   * author). Each request on it is re-authorized (RT-037); the object key never
   * leaves the server. See communication/profile/avatar-urls.
   */
  authorAvatarUrl: string | null;

  onBehalfMode: string | null;
  type: string;
  body: string | null;
  /** For `type: 'system'`: the parsed event (`{ kind, ...details }`); otherwise null. */
  systemEvent: Record<string, unknown> | null;
  visibility: string;
  moderation: string;
  origin: string;
  replyToMessageId: string | null;
  clientMessageId: string | null;
  deletedAt: string | null;
  deletedForAll: boolean;
  createdAt: string;
  /** When the author last edited it; null when never edited. `body` is the current wording. */
  editedAt: string | null;
  attachments: AttachmentDto[];
  reactions: Array<{ actorId: string; emoji: string }>;
  /** A copy forwarded by its author; shown as "Forwarded". The source is never named. */
  forwarded: boolean;
  /**
   * PD-21: an administrator sent it in a support session, acting as its author.
   * Every client shows it as "Sent by support"; who the administrator was is in
   * the audit record, not on the message.
   */
  sentBySupport: boolean;
  /** The VIEWER's private bookmark. Set on the message page and the starred list. */
  starred?: boolean;
  /** Pinned for everyone in this conversation (at most three). */
  pinned?: boolean;
  /**
   * PD-37: the ticks on the VIEWER'S OWN message -- `sent`, `delivered` (every
   * countable recipient has it) or `read` (every countable recipient read it).
   * Null on anyone else's message, on a message deleted for everyone, and in a
   * direct teacher<->parent conversation (PD-7: no signals between them).
   *
   * There is deliberately no per-recipient detail here. It used to be a
   * `receipts` array of every recipient's delivered/read times, sent to every
   * reader -- silent members and deleted messages included. Who read a message
   * and when is now `GET .../messages/:id/info`, for its author and for staff.
   */
  status: MessageStatus | null;
  /**
   * PD-11: present only when `type` is `card` -- what a ticket recorded, for the
   * client to draw as a card. `body` still carries a plain-text rendering, so a
   * build that predates cards shows a readable message instead of nothing.
   */
  card: MessageCardDto | null;
}

export interface MessageCardDto {
  kind: string;
  lessonId: string | null;
  payload: Record<string, unknown>;
}

export interface ConversationMemberDto {
  actorId: string;
  actorKind: string;
  memberRole: string;
  isSilent: boolean;

  /**
   * PD-26: a teacher member who is away today, and the last day they are away
   * (YYYY-MM-DD). Messaging still works; a client shows "On leave until ...".
   * Staff read why (leave | suspended | day_off); anyone else reads leave or
   * away -- a suspension is the administration's business. Absent when not
   * away, and on routes that do not compute it.
   */
  away?: MemberAwayDto;

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

  /** The member's profile photo as this viewer sees it here, or null. See MessageDto.authorAvatarUrl. */
  avatarUrl: string | null;
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
  /** The child's photo, set by a parent, as this viewer sees it here; or null. */
  avatarUrl?: string | null;
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

  /**
   * Will THIS viewer's messages be held for approval here? Always false since
   * PD-14 (2026-10-20): every message is published when it is sent. Kept so a
   * client built before PD-14 hides its "needs approval" notice.
   */
  viewerRequiresApproval?: boolean;

  /**
   * PD-14: the author kinds ('teacher' | 'contact' | 'staff') whose messages
   * THIS viewer may edit or delete for everyone after sending -- a hint for the
   * menu; the edit and delete routes decide again. Empty for anyone who is not
   * in charge here. Computed by the detail route only.
   */
  viewerModerates?: string[];

  /** The viewer's own pin / archive / mute / favorite, as setPreferences stored them. */
  viewerState?: ConversationViewerStateDto;

  /**
   * The newest message THIS viewer may see, for a list row; null when there is
   * none. Chosen by the message page's own visibility rule.
   */
  lastMessage?: LastMessageDto | null;

  /**
   * A GROUP's picture: the photo of the one child it is about (a student group's
   * learner, or a family group linking exactly one child), signed for the viewer
   * here; null otherwise. Not set on a 1:1 -- a client pictures that by the
   * other member.
   */
  avatarUrl?: string | null;
  /** The VIEWER's own private labels (owner decision 2026-10-19: per staff member). Staff only. */
  labels?: Array<{ id: string; name: string; color: string }>;

  /**
   * PD-33: the supervisor here is away and their backup covers for them until
   * `until` ("Amira is covering for Noura until 3 Nov"). Null when nobody is
   * covering; absent when not computed. Every viewer of the conversation may
   * see it: the parent is told who answers.
   */
  cover?: ConversationCoverDto | null;
}

export interface ConversationCoverDto {
  supervisorId: string;
  supervisorName: string;
  coverId: string;
  coverName: string;
  /** ISO-8601: the cover ends (and the supervisor is back) at this moment. */
  until: string;
}

export interface ConversationViewerStateDto {
  pinned: boolean;
  /** In the viewer's own Favorites list. */
  favorite: boolean;
  archived: boolean;
  mutedUntil: string | null;
  /** The viewer's OWN background preset for this chat; null = the default look. */
  theme: string | null;
  /** The viewer's OWN wallpaper photo for this chat, as a link signed for them; null when none. */
  wallpaperUrl: string | null;
  /**
   * PD-35: the viewer's open visible seat here (joined by choice). Present only
   * while they hold one -- only staff ever do; absent for everyone else.
   */
  seat?: { reason: string; joinedAt: string; effective: boolean };
}

export interface LastMessageDto {
  seq: string | null;
  type: string;
  /** The text of a text message; null for media, system events and deleted messages. */
  text: string | null;
  /** For a system message, its event kind (e.g. `group.created`); the client words it. */
  systemKind: string | null;
  authorKind: string;
  authorId: string | null;
  deleted: boolean;
  createdAt: string;
}

/** A list-row preview of a message. Text is capped: a row shows a line, not a page. */
export function toLastMessageDto(m: Message): LastMessageDto {
  const deleted = m.deletedForAll;
  const system = m.type === 'system';
  return {
    seq: m.seq?.toString() ?? null,
    type: m.type,
    text: !deleted && !system && m.type === 'text' && m.body ? m.body.slice(0, 160) : null,
    systemKind: system && !deleted ? (parseSystemEvent(m.body)?.kind as string | undefined) ?? null : null,
    authorKind: m.authorType,
    authorId: m.authorId,
    deleted,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * A system message's event. System messages are written only by the server
 * (ConversationService.systemMessage) as a JSON object with a `kind`; a body
 * that is not one yields null rather than a guess.
 */
export function parseSystemEvent(body: string | null): Record<string, unknown> | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof (parsed as { kind?: unknown }).kind === 'string') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not an event
  }
  return null;
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
export interface MemberAwayDto {
  kind: 'leave' | 'suspended' | 'day_off' | 'away';
  until: string;
}

export interface ResolvedMember {
  actorId: string;
  actorKind: string;
  memberRole: string;
  isSilent: boolean;
  away?: MemberAwayDto;
  /** '' when the actor no longer resolves. Never an id. */
  displayName: string;
  /** Advisory; see ConversationMemberDto.canOpenDirect. False when unknown. */
  canOpenDirect: boolean;
  /** Signed for the viewer in this conversation; null when none or unresolved. */
  avatarUrl?: string | null;
}

export function toConversationDto(
  c: ConversationWithLearner,
  members?: ResolvedMember[],
  extra?: {
    unreadCount?: number;
    viewerRequiresApproval?: boolean;
    viewerModerates?: string[];
    viewerState?: ConversationViewerStateDto;
    lastMessage?: LastMessageDto | null;
    /** The learner's photo link, signed by the caller for the viewer; omitted when unknown. */
    learnerAvatarUrl?: string | null;
    /** The group's picture (its one child's photo), signed by the caller. */
    avatarUrl?: string | null;
    /** The VIEWER's own private labels (staff only). Omitted for anyone else. */
    labels?: Array<{ id: string; name: string; color: string }>;
    /** PD-33: the live cover, or null; omitted when not computed. */
    cover?: ConversationCoverDto | null;
  },
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
      avatarUrl: m.avatarUrl ?? null,
      ...(m.away ? { away: m.away } : {}),
    })),
    // Two fields enumerated by hand, like every other field here: the Learner
    // row is never spread, so `level`, `nextClassAt` and `teacherId` cannot
    // reach a client because somebody widened an include.
    learner: c.learner
      ? { id: c.learner.id, name: c.learner.name, avatarUrl: extra?.learnerAvatarUrl ?? null }
      : undefined,
    unreadCount: extra?.unreadCount,
    viewerRequiresApproval: extra?.viewerRequiresApproval,
    ...(extra?.viewerModerates ? { viewerModerates: extra.viewerModerates } : {}),
    viewerState: extra?.viewerState,
    lastMessage: extra?.lastMessage,
    avatarUrl: c.type === 'direct' ? undefined : (extra?.avatarUrl ?? null),
    ...(extra?.labels ? { labels: extra.labels } : {}),
    ...(extra?.cover !== undefined ? { cover: extra.cover } : {}),
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

/** PD-37: the ticks on a message, for its author. */
export type MessageStatus = 'sent' | 'delivered' | 'read';

/**
 * PD-37: what the mapper needs to draw ticks, resolved by the caller in one
 * query per page (`receipt-view.ts`). The mapper never queries.
 */
export interface ReceiptView {
  viewerId: string;
  /**
   * The conversation's countable readers -- live members who are neither
   * silent nor observers -- or null when the conversation shows no receipts
   * at all (PD-7 direct teacher<->parent).
   */
  countableIn(conversationId: string): ReadonlySet<string> | null;
}

/**
 * The WhatsApp group rule over countable readers only: `read` when every one
 * of them read it, `delivered` when every one has it, otherwise `sent`. A
 * recipient who has since left, or who reads without a seat (PD-8 standing,
 * which never gets a receipt row), or who sits silent or as an observer,
 * neither counts nor blocks.
 */
export function messageStatus(
  m: Pick<Message, 'authorId' | 'conversationId' | 'deletedForAll'> & { receipts?: MessageReceipt[] },
  view: ReceiptView | undefined,
): MessageStatus | null {
  if (!view || m.deletedForAll || !m.authorId || !m.conversationId) return null;
  if (m.authorId !== view.viewerId) return null;
  const countable = view.countableIn(m.conversationId);
  if (!countable) return null;
  const counted = (m.receipts ?? []).filter((r) => r.actorId !== m.authorId && countable.has(r.actorId));
  if (counted.length > 0 && counted.every((r) => r.state === ReceiptState.READ)) return ReceiptState.READ;
  if (counted.length > 0 && counted.every((r) => r.state !== ReceiptState.SENT)) return ReceiptState.DELIVERED;
  return ReceiptState.SENT;
}

/** PD-37: one person in a message's "Message info". */
export interface MessageInfoEntryDto {
  actorId: string;
  actorKind: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** When they read it (readBy), when it reached them (deliveredTo), or null (pending). */
  at: string | null;
}

/** PD-37: who read a message and when. Countable readers only. */
export interface MessageInfoDto {
  messageId: string;
  status: MessageStatus;
  readBy: MessageInfoEntryDto[];
  deliveredTo: MessageInfoEntryDto[];
  pending: MessageInfoEntryDto[];
}

export type MessageWithRelations = Message & {
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
  receipts?: MessageReceipt[];
  card?: MessageCard | null;
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
  /** Signs a resolved author's photo for the viewer; absent means no photo links. */
  avatarFor?: (author: Actor) => string | null,
  /** PD-37: who the viewer is and who counts as a reader; absent means `status: null`. */
  receiptView?: ReceiptView,
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
    authorAvatarUrl: (() => {
      const resolved = author ? authors.get(actorRefKey(author)) : undefined;
      return resolved && avatarFor ? avatarFor(resolved) : null;
    })(),
    onBehalfMode: m.onBehalfMode,
    type: m.type,
    // A message deleted for everyone keeps its row for auditability, but its
    // body is never served again.
    body: hidden ? null : m.body,
    // A system message's event, parsed here so a client never has to parse
    // JSON out of `body` (which stays, unchanged, for clients that already do).
    systemEvent: !hidden && m.type === 'system' ? parseSystemEvent(m.body) : null,
    visibility: m.visibility,
    moderation: m.moderation,
    origin: m.origin,
    replyToMessageId: m.replyToMessageId,
    forwarded: m.forwarded,
    sentBySupport: m.impersonationId !== null,
    clientMessageId: m.clientMessageId,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    deletedForAll: m.deletedForAll,
    createdAt: m.createdAt.toISOString(),
    editedAt: hidden ? null : (m.editedAt?.toISOString() ?? null),
    attachments: hidden
      ? []
      : (m.attachments ?? []).map((a) => {
          const signed = signedUrls.get(a.id);
          return toAttachmentDto(a, signed?.url ?? null, signed?.thumbnailUrl ?? null);
        }),
    reactions: (m.reactions ?? []).map((r) => ({ actorId: r.actorId, emoji: r.emoji })),
    status: messageStatus(m, receiptView),
    card:
      !hidden && m.card
        ? { kind: m.card.kind, lessonId: m.card.lessonId, payload: m.card.payload as Record<string, unknown> }
        : null,
  };
}

/** What a pending message looks like to someone who may not read it yet. */
export function redactPending(dto: MessageDto): MessageDto {
  if (dto.moderation !== Moderation.PENDING) return dto;
  return { ...dto, body: null, attachments: [] };
}
