import type { ConversationMember } from '@prisma/client';
import type { ReceiptView } from '../contracts/dto';
import { ActorKind, ConversationType, MemberRole } from '../contracts/vocab';

/**
 * PD-37: who counts as a reader. A SEATED member -- live, not silent, not an
 * observer. Only they produce "Seen" and appear in Message info. Someone who
 * reads through PD-8 standing without a seat (a manager, the super admin)
 * never gets a receipt row at all, so they cannot produce Seen by
 * construction; this rule handles the members who DO have rows but must not
 * be shown.
 */
export function isCountableReader(
  m: Pick<ConversationMember, 'leftAt' | 'isSilent' | 'memberRole'>,
): boolean {
  return m.leftAt === null && !m.isSilent && m.memberRole !== MemberRole.OBSERVER;
}

/**
 * PD-7: a direct conversation pairing a teacher with a family contact carries
 * no signals between them -- no typing, no reactions, and no receipts. The
 * same rule as `ConversationService.isDirectTeacherParent`, over rows the
 * caller already holds.
 */
export function isDirectTeacherParent(
  conversationType: string,
  liveMembers: ReadonlyArray<Pick<ConversationMember, 'actorKind'>>,
): boolean {
  return (
    conversationType === ConversationType.DIRECT &&
    liveMembers.some((m) => m.actorKind === ActorKind.TEACHER) &&
    liveMembers.some((m) => m.actorKind === ActorKind.CONTACT)
  );
}

export type MemberRow = Pick<ConversationMember, 'conversationId' | 'actorId' | 'actorKind' | 'leftAt' | 'isSilent' | 'memberRole'>;

/** A ReceiptView over live member rows of the conversations on one page. */
export function buildReceiptView(
  viewerId: string,
  conversationTypes: ReadonlyMap<string, string>,
  liveMembers: readonly MemberRow[],
): ReceiptView {
  const byConv = new Map<string, MemberRow[]>();
  for (const m of liveMembers) {
    if (m.leftAt !== null) continue;
    byConv.set(m.conversationId, [...(byConv.get(m.conversationId) ?? []), m]);
  }
  const countable = new Map<string, ReadonlySet<string> | null>();
  for (const [convId, type] of conversationTypes) {
    const members = byConv.get(convId) ?? [];
    countable.set(
      convId,
      isDirectTeacherParent(type, members)
        ? null
        : new Set(members.filter(isCountableReader).map((m) => m.actorId)),
    );
  }
  return { viewerId, countableIn: (conversationId) => countable.get(conversationId) ?? null };
}
