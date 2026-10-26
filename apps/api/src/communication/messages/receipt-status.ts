import type { PrismaService } from '../../platform/prisma.service';
import { messageStatus, MessageStatus } from '../contracts/dto';
import { isCountableReader, isDirectTeacherParent } from './receipt-view';

/**
 * At most this many messages are re-announced per cursor move. A first read
 * of a long history moves the cursor across thousands of messages; their
 * authors' ticks are on the page they fetch anyway, and only the newest are on
 * screen. The newest are announced, the rest are read on the next fetch.
 */
export const STATUS_ANNOUNCE_LIMIT = 200;

export interface StatusItem {
  messageId: string;
  seq: string;
  status: MessageStatus;
}

/**
 * PD-37: the ticks on every message in (fromSeq, toSeq], grouped by AUTHOR --
 * what the outbox worker sends each author after a reader's cursor moved.
 *
 * A plain function over Prisma, not a service method, so the worker can use it
 * without depending on MessageService (whose graph reaches the realtime
 * publisher: the provider cycle PD-34 hit).
 *
 * Same rule as the message page (`messageStatus`): countable readers only, a
 * deleted-for-all message is never announced, and a PD-7 direct
 * teacher<->parent conversation announces nothing at all.
 */
export async function statusUpdatesByAuthor(
  prisma: PrismaService,
  conversationId: string,
  fromSeq: bigint,
  toSeq: bigint,
): Promise<Map<string, StatusItem[]>> {
  const out = new Map<string, StatusItem[]>();
  if (toSeq <= fromSeq) return out;

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      type: true,
      members: {
        where: { leftAt: null },
        select: { actorId: true, actorKind: true, leftAt: true, isSilent: true, memberRole: true },
      },
    },
  });
  if (!conv || isDirectTeacherParent(conv.type, conv.members)) return out;
  const countable = new Set(conv.members.filter(isCountableReader).map((m) => m.actorId));

  const rows = await prisma.message.findMany({
    where: {
      conversationId,
      seq: { gt: fromSeq, lte: toSeq },
      authorId: { not: null },
      deletedForAll: false,
    },
    include: { receipts: true },
    orderBy: { seq: 'desc' },
    take: STATUS_ANNOUNCE_LIMIT,
  });

  for (const m of rows) {
    const authorId = m.authorId!;
    const status = messageStatus(m, { viewerId: authorId, countableIn: () => countable });
    if (!status || m.seq === null) continue;
    const items = out.get(authorId) ?? [];
    items.push({ messageId: m.id, seq: m.seq.toString(), status });
    out.set(authorId, items);
  }
  // Oldest first within an author, the order a client applies them in.
  for (const items of out.values()) items.reverse();
  return out;
}
