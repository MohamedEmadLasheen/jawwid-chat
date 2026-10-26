import { CommError, CommErrorCode } from '../../platform/errors';
import { isUuid } from '../conversations/conversation.service';
import { ConversationType } from '../contracts/vocab';

/**
 * PD-36 -- the pure half of @mentions: what a client may send, and how many of
 * them a conversation takes. Who may be mentioned is decided by MentionService
 * against the database (chat.mention_eligible_staff / mention_role_targets);
 * nothing here grants anything.
 */

export const MentionRole = { SUPERVISOR: 'supervisor', ADMIN: 'admin' } as const;
export type MentionRole = (typeof MentionRole)[keyof typeof MentionRole];
const ROLES: ReadonlySet<string> = new Set(Object.values(MentionRole));

export const MentionState = {
  NOTIFIED: 'notified',
  PENDING: 'pending',
  JOINED: 'joined',
  DISMISSED: 'dismissed',
  EXPIRED: 'expired',
  VOID: 'void',
  REMOVED: 'removed',
} as const;
export type MentionState = (typeof MentionState)[keyof typeof MentionState];

/** More than this in one message is not a mention, it is a broadcast. */
export const MAX_MENTIONS_PER_MESSAGE = 10;
const MIN_SPAN = 2;
const MAX_SPAN = 200;

/** One "@..." in the text as the client sent it: a person, or (parents) a role. */
export type MentionRequest =
  | { start: number; length: number; actorId: string; role?: undefined }
  | { start: number; length: number; role: MentionRole; actorId?: undefined };

/**
 * The client's `mentions` array, validated against the text it annotates.
 *
 * Offsets are UTF-16 code units -- what a JS string and a Dart string both
 * index by -- so `body.slice(start, start + length)` is exactly the chip the
 * sender saw, in either script and either direction. Each span starts with
 * "@" and no two overlap. A malformed list refuses the send (400) rather than
 * dropping silently: it is a client bug, and a dropped summons is a missed one.
 */
export function parseMentionRequests(raw: unknown, body: string | null | undefined): MentionRequest[] {
  if (raw === undefined || raw === null) return [];
  const invalid = (reason: string) => new CommError(CommErrorCode.MENTION_INVALID, reason, 400);
  if (!Array.isArray(raw)) throw invalid('mentions must be a list');
  if (raw.length === 0) return [];
  if (raw.length > MAX_MENTIONS_PER_MESSAGE) throw invalid(`at most ${MAX_MENTIONS_PER_MESSAGE} mentions in one message`);
  const text = typeof body === 'string' ? body : '';
  if (!text) throw invalid('a mention needs the text it sits in');

  const out: MentionRequest[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw invalid('a mention is an object');
    const { start, length, actorId, role } = item as Record<string, unknown>;
    if (!Number.isInteger(start) || !Number.isInteger(length)) throw invalid('a mention has an integer start and length');
    const s = start as number;
    const l = length as number;
    if (s < 0 || l < MIN_SPAN || l > MAX_SPAN || s + l > text.length) throw invalid('a mention lies inside the text');
    if (text[s] !== '@') throw invalid('a mention starts with "@"');
    const hasActor = actorId !== undefined && actorId !== null;
    const hasRole = role !== undefined && role !== null;
    if (hasActor === hasRole) throw invalid('a mention names a person or a role, not both');
    if (hasActor) {
      if (!isUuid(actorId)) throw invalid('a mention names a person by id');
      out.push({ start: s, length: l, actorId });
    } else {
      if (typeof role !== 'string' || !ROLES.has(role)) throw invalid('the role is supervisor or admin');
      out.push({ start: s, length: l, role: role as MentionRole });
    }
  }
  const sorted = [...out].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.start < sorted[i - 1]!.start + sorted[i - 1]!.length) throw invalid('mentions do not overlap');
  }
  return out;
}

/** A mention resolved to one person (a role resolves to one per person, sharing a span). */
export interface PlannedMention {
  start: number;
  length: number;
  targetActorId: string;
  targetKind: string;
  viaRole: MentionRole | null;
  /** The target is not a live member: they are asked to step in. */
  isSummons: boolean;
  targetIsSuperAdmin: boolean;
}

export interface MentionCaps {
  perSenderHour: number;
  superAdminDay: number;
  parentRoleDay: number;
}

/** What this conversation has already taken, counted in spans (one "@..." = one mention). */
export interface MentionUsage {
  /** By this sender, in this conversation, in the last hour. */
  senderHour: number;
  /** Of the super admin, by anyone, in this conversation, in the last day. */
  superAdminDay: number;
  /** Role mentions by this sender, in this conversation, in the last day. */
  senderRoleDay: number;
}

/**
 * The rate limits (PD-36): which planned mentions this send may still make.
 *
 * Counted in SPANS, in the order the sender wrote them: a parent's "@admin"
 * that reaches a supervisor and a manager is one mention, not two. A span over
 * any cap is dropped whole -- its "@..." stays in the text as plain words, the
 * message still goes, and `limited` tells the sender why nobody was pinged.
 * Losing the message would cost more than losing the ping.
 */
export function applyMentionCaps(
  planned: readonly PlannedMention[],
  usage: MentionUsage,
  caps: MentionCaps,
): { kept: PlannedMention[]; limited: boolean } {
  const spans = new Map<number, PlannedMention[]>();
  for (const p of planned) spans.set(p.start, [...(spans.get(p.start) ?? []), p]);

  let sender = usage.senderHour;
  let superAdmin = usage.superAdminDay;
  let roles = usage.senderRoleDay;
  const kept: PlannedMention[] = [];
  let limited = false;
  for (const start of [...spans.keys()].sort((a, b) => a - b)) {
    const group = spans.get(start)!;
    const isRole = group.some((p) => p.viaRole !== null);
    const reachesSuperAdmin = group.some((p) => p.targetIsSuperAdmin);
    if (
      sender >= caps.perSenderHour ||
      (reachesSuperAdmin && superAdmin >= caps.superAdminDay) ||
      (isRole && roles >= caps.parentRoleDay)
    ) {
      limited = true;
      continue;
    }
    sender += 1;
    if (reachesSuperAdmin) superAdmin += 1;
    if (isRole) roles += 1;
    kept.push(...group);
  }
  return { kept, limited };
}

/**
 * After an edit, which of a message's mentions still stand: a span whose text
 * changed (or that the new text no longer reaches) no longer mentions anyone.
 * An edit cannot ADD a mention -- mentions are made when a message is sent.
 */
export function mentionSpanSurvivesEdit(
  oldBody: string | null,
  newBody: string | null,
  span: { start: number; length: number },
): boolean {
  if (oldBody === null || newBody === null) return false;
  const end = span.start + span.length;
  if (end > newBody.length) return false;
  return oldBody.slice(span.start, end) === newBody.slice(span.start, end);
}

/** The conversation types whose mention push says "a family group". */
const FAMILY_GROUPS: ReadonlySet<string> = new Set([ConversationType.STUDENT_GROUP, ConversationType.FAMILY_GROUP]);

/** Which push rule (and so which wording) a mention in this conversation type gets. */
export function mentionRuleFor(conversationType: string): 'mention' | 'mention_group' {
  return FAMILY_GROUPS.has(conversationType) ? 'mention_group' : 'mention';
}
