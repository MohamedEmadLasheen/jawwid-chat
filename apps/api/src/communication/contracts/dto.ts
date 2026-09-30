import {
  Conversation,
  ConversationMember,
  ConversationParticipantState,
  Learner,
  Message,
  MessageAttachment,
  MessageReaction,
  MessageReceipt,
} from '@prisma/client';
import type { DisplayIdentity } from '../../platform/directory.service';
import { ActorKind, ConversationState, MessageType, Moderation } from './vocab';

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
 * A system event, as structured data rather than prose.
 *
 * `chat.message.body` stores `{"kind":"group.created","learner":"Adam"}` for a
 * system message, and that string used to be served verbatim as `body` -- which
 * is how a parent came to be shown raw JSON in their own chat. The payload is
 * not the problem; SERVING IT AS PROSE was. So it is parsed here, published as
 * a named kind plus parameters, and `body` is nulled for system messages so
 * there is no longer any field on this DTO through which the JSON can reach a
 * screen.
 *
 * The client renders `kind` through its own localisation and must handle a kind
 * it does not recognise without crashing -- which is the whole reason this is a
 * string and an open bag rather than a closed enum. Backend gap O6 asked for
 * "localised, or key + params"; this is the key-and-params half, and it is the
 * half that belongs on the wire, because only the client knows the reader's
 * language.
 */
export interface SystemEventDto {
  kind: string;
  params: Record<string, string>;
}

export interface MessageDto {
  id: string;
  conversationId: string | null;
  /** Stringified: seq is 64-bit and JSON numbers are not safe at that width. */
  seq: string | null;
  authorKind: string;
  authorId: string | null;
  /**
   * The author's display name, when the caller resolved one.
   *
   * Closes backend gap O3 for messages. `null` means "not resolved" -- either
   * the caller did not ask, or the principal no longer exists -- and never
   * "this author has no name". The client must render the difference; the id is
   * never a fallback (boundary doc 25).
   */
  authorName: string | null;
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
  /** Present only on `type: 'system'`; null on every ordinary message. */
  systemEvent: SystemEventDto | null;
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
   * Closes backend gap O3 for membership. `null` means the principal could not
   * be resolved, never "unnamed": the client shows a neutral word in that case
   * and must never fall back to the id.
   */
  displayName: string | null;
}

/**
 * The other side of a 1:1 conversation.
 *
 * A direct conversation has `title = null` by construction -- it is not a room
 * somebody named, it is a channel between two people -- so a client had nothing
 * to render and drew a blank row with a placeholder avatar. The name it needs
 * is not derivable from the conversation at all; it is a property of the OTHER
 * MEMBER, which only the server can resolve.
 *
 * Present only for `type: 'direct'`, and only for the actor who asked: the
 * counterpart is "whoever is not you", so the same row yields a different
 * answer per caller and can never be cached across actors. Absent on group
 * types, where `title` and `learner` already carry the identity.
 */
export interface ConversationCounterpartDto {
  actorId: string;
  actorKind: string;
  displayName: string | null;
}

/**
 * This conversation's last message, reduced to what a list row shows.
 *
 * Closes backend gap O2. Never the message body verbatim for every type: a
 * voice note has no body worth showing and a system message's body is a JSON
 * payload, so the type travels with the text and the client decides the words.
 * `preview` is null whenever the type alone is the whole story.
 */
export interface ConversationLastMessageDto {
  id: string;
  type: string;
  authorKind: string;
  authorId: string | null;
  authorName: string | null;
  /** Trimmed and bounded; null for types that have no text to show. */
  preview: string | null;
  /** Present only for a system last-message, for the same reason as MessageDto. */
  systemEvent: SystemEventDto | null;
  createdAt: string;
}

/**
 * The calling actor's OWN view of a conversation: pinned, muted, archived.
 *
 * These live in `chat.conversation_participant_state`, one row per actor per
 * conversation, and they were already being written by
 * `ConversationService.setPreferences`. Nothing ever read them back, so pin and
 * mute behaved as though they had been accepted and discarded -- the client
 * could set them and never see them again. They are per-actor by definition:
 * one parent pinning a conversation must not pin it for the teacher.
 */
export interface ConversationViewerStateDto {
  pinnedAt: string | null;
  mutedUntil: string | null;
  /**
   * When THIS actor archived their own copy. Distinct from the conversation's
   * own `archivedAt`, which is staff closing the room for everybody and is what
   * makes it read-only.
   */
  archivedAt: string | null;
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

  /**
   * Whether THIS caller's next message would be held for approval.
   *
   * The two flags above are the stored policy and stay on the contract, but
   * they are not the answer to the question a composer asks. Deciding it on the
   * client meant re-implementing the rule there, and the client got it wrong in
   * both directions: it OR-ed the two flags together, so a parent was told
   * their messages were reviewed because the TEACHER's were, and it ignored
   * conversation type, so the notice appeared on a 1:1 where approval has never
   * applied.
   *
   * So the server answers it, using the same function that decides the
   * moderation a message is actually stored with. There is one rule and one
   * implementation of it. Optional only because the create/sync endpoints do
   * not resolve an actor; absent means "not computed here", never `false`.
   */
  viewerRequiresApproval?: boolean;

  members?: ConversationMemberDto[];

  /** The other participant, for `type: 'direct'` only. */
  counterpart?: ConversationCounterpartDto | null;

  /** The caller's own pin/mute/archive state. Absent means "not loaded here". */
  viewerState?: ConversationViewerStateDto;

  /** The last message, for the list row. `null` means the conversation is empty. */
  lastMessage?: ConversationLastMessageDto | null;

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
 * Everything a caller may have resolved alongside the conversation row.
 *
 * A bag rather than more positional parameters: the two existing call shapes
 * (`toConversationDto(conv)` and `toConversationDto(conv, undefined, {...})`)
 * keep working unchanged, and a caller that resolves nothing extra pays for
 * nothing.
 */
export interface ConversationExtras {
  unreadCount?: number;
  viewerRequiresApproval?: boolean;
  counterpart?: ConversationCounterpartDto | null;
  viewerState?: ConversationParticipantState | null;
  lastMessage?: ConversationLastMessageDto | null;
  /** Names for `members` and for `counterpart`. Absent leaves both unresolved. */
  directory?: Map<string, DisplayIdentity>;
}

/**
 * Turn a system message's stored payload into a named event.
 *
 * Total, and deliberately forgiving: a body that is not an object, or not JSON
 * at all, yields `null` rather than throwing. A malformed row must cost one
 * unrendered system line, never a 500 on the whole conversation.
 *
 * Every parameter is stringified. The client formats them into a sentence and
 * has no use for a number's numeric-ness, and this way a payload field that is
 * an object cannot arrive as a nested structure the client did not expect.
 */
export function toSystemEventDto(body: string | null): SystemEventDto | null {
  if (!body) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== 'string' || kind.length === 0) return null;

  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'kind') continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') continue;
    params[key] = String(value);
  }
  return { kind, params };
}

/** How much of a message body a list row may carry. */
const PREVIEW_MAX_CHARS = 140;

/**
 * The text half of a list-row preview.
 *
 * Null whenever the type alone says everything: a voice note, an image or a
 * file has nothing to quote, and a system message's body is a payload rather
 * than prose. Returning the payload here is exactly the defect this replaces.
 */
export function toPreviewText(type: string, body: string | null): string | null {
  if (type === MessageType.SYSTEM) return null;
  if (type !== MessageType.TEXT) return null;
  const trimmed = (body ?? '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > PREVIEW_MAX_CHARS
    ? `${trimmed.slice(0, PREVIEW_MAX_CHARS)}\u2026`
    : trimmed;
}

export function toConversationDto(
  c: ConversationWithLearner,
  members?: ConversationMember[],
  extra?: ConversationExtras,
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
    viewerRequiresApproval: extra?.viewerRequiresApproval,
    members: members?.map((m) => ({
      actorId: m.actorId,
      actorKind: m.actorKind,
      memberRole: m.memberRole,
      isSilent: m.isSilent,
      displayName: extra?.directory?.get(m.actorId)?.displayName ?? null,
    })),
    counterpart:
      extra?.counterpart === undefined
        ? undefined
        : extra.counterpart === null
          ? null
          : {
              actorId: extra.counterpart.actorId,
              actorKind: extra.counterpart.actorKind,
              displayName:
                extra.counterpart.displayName ??
                extra.directory?.get(extra.counterpart.actorId)?.displayName ??
                null,
            },
    viewerState:
      extra?.viewerState === undefined
        ? undefined
        : {
            pinnedAt: extra.viewerState?.pinnedAt?.toISOString() ?? null,
            mutedUntil: extra.viewerState?.mutedUntil?.toISOString() ?? null,
            archivedAt: extra.viewerState?.archivedAt?.toISOString() ?? null,
          },
    lastMessage: extra?.lastMessage,
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
  directory?: Map<string, DisplayIdentity>,
): MessageDto {
  const hidden = m.deletedForAll;
  const isSystem = m.authorType === ActorKind.SYSTEM || m.type === MessageType.SYSTEM;
  const systemEvent = isSystem && !hidden ? toSystemEventDto(m.body) : null;
  return {
    id: m.id,
    conversationId: m.conversationId,
    seq: m.seq?.toString() ?? null,
    authorKind: m.authorType,
    authorId: m.authorId,
    authorName: m.authorId ? (directory?.get(m.authorId)?.displayName ?? null) : null,
    onBehalfMode: m.onBehalfMode,
    type: m.type,
    // A message deleted for everyone keeps its row for auditability, but its
    // body is never served again.
    //
    // A SYSTEM message's body is never served either, deleted or not: it is a
    // JSON payload, it travels as `systemEvent` below, and leaving it here as
    // well would leave the raw-payload-on-screen defect one careless client
    // away from returning.
    body: hidden || isSystem ? null : m.body,
    visibility: m.visibility,
    moderation: m.moderation,
    origin: m.origin,
    replyToMessageId: m.replyToMessageId,
    clientMessageId: m.clientMessageId,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    deletedForAll: m.deletedForAll,
    createdAt: m.createdAt.toISOString(),
    systemEvent,
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
